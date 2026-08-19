import { X, Image as ImageIcon, Sparkles, Check, Loader2, Upload, Link as LinkIcon, Search } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";
import { removeBackgroundClient } from "@/lib/bg-removal-client";
import { importProductFromUrl, type CompositionEntry } from "@/lib/import-url.functions";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import { downloadImportImage } from "@/lib/import-image.functions";
import { searchProductLibrary, type ProductLibraryItem } from "@/lib/product-library";
import { searchSharedLibrary, syncMySharedLibrary, type SharedLibraryItem } from "@/lib/shared-library.functions";
import { buildProductSearchQuery, buildGoogleSearchUrl, buildGoogleLensUrl } from "@/lib/search-online";

import { compressImageForUpload } from "@/lib/image-compress";
import { sizeEquivalences, isShoeCategory } from "@/lib/size-conversion";
import { trimFileMargins } from "@/lib/auto-crop";


import {
  ITEM_CATEGORIES as categories,
  SEASON_OPTIONS as seasonOptions,
  STYLE_OPTIONS as styleOptions,
  OCCASION_OPTIONS as occasionOptions,
  MATERIAL_OPTIONS as materialOptions,
  CURRENCY_OPTIONS as currencyOptions,
  SLEEVE_LENGTH_OPTIONS as sleeveLengthOptions,
  FIT_OPTIONS as fitOptions,
  HEEL_HEIGHT_OPTIONS as heelHeightOptions,
  TOE_SHAPE_OPTIONS as toeShapeOptions,
  CLOSURE_OPTIONS as closureOptions,
  GENDER_OPTIONS as genderOptions,
  STYLE_TAG_OPTIONS as styleTagOptions,
  subcategoriesFor,
  attributeAppliesTo,
  lengthOptionsFor,
  lengthAppliesTo,
} from "@/lib/wardrobe-options";
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);
// Same 1-5 scale the outfit/trip engine already scores every piece on
// (see the Outfit Engine spec) — surfaced here so it's visible and
// correctable, not just something the AI silently assigns.
const FORMALITY_OPTIONS = ["1 · Very casual", "2 · Casual", "3 · Smart casual", "4 · Elegant", "5 · Formal"];
const DAY_EVENING_OPTIONS: { value: string; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "both", label: "Both" },
];

function isImageFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("image/") || imageExtensions.has(ext);
}

function readFileAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(f);
  });
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

function isCheckerPixel(r: number, g: number, b: number): boolean {
  const grey = Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10;
  if (!grey) return false;
  return r >= 235 || (r >= 175 && r <= 225);
}

async function ensureTransparentPng(
  dataUrl: string,
  filename: string,
): Promise<{ file: File; isTransparent: boolean }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("transparency check: image failed to load"));
    el.src = dataUrl;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("transparency check: no 2d context");
  ctx.drawImage(img, 0, 0);

  let isTransparent = false;
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    let hasAlpha = false;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 250) { hasAlpha = true; break; }
    }

    const corner = (x: number, y: number) => {
      const o = (y * w + x) * 4;
      return [d[o], d[o + 1], d[o + 2], d[o + 3]] as const;
    };
    const tl = corner(0, 0);
    const tr = corner(w - 1, 0);
    const bl = corner(0, h - 1);
    const br = corner(w - 1, h - 1);
    const checkerCorners = [tl, tr, bl, br].filter((p) => isCheckerPixel(p[0], p[1], p[2])).length;

    console.log(
      "[AURA transparency] dims", w, "x", h,
      "hasAlpha", hasAlpha,
      "checkerCorners", checkerCorners,
      "corners", { tl, tr, bl, br },
    );

    if (hasAlpha) {
      isTransparent = true;
    } else if (checkerCorners >= 3) {
      console.warn("[AURA transparency] baked checkerboard detected — zeroing alpha on checker pixels");
      for (let i = 0; i < d.length; i += 4) {
        if (isCheckerPixel(d[i], d[i + 1], d[i + 2])) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      isTransparent = true;
    } else {
      console.warn("[AURA transparency] no alpha and no recognisable checker — leaving image untouched");
    }
  } catch (e) {
    console.warn("[AURA transparency] pixel inspection failed", e);
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("transparency check: toBlob null"))), "image/png"),
  );
  console.log("[AURA transparency] output bytes", blob.size, "isTransparent", isTransparent);
  return { file: new File([blob], filename, { type: "image/png" }), isTransparent };
}

async function normalizeForPipeline(f: File): Promise<File> {
  if (f.type === "image/jpeg" || f.type === "image/png") return f;
  try {
    const bitmap = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return f;
    return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("[AURA normalize] re-encode failed, keeping original", e);
    return f;
  }
}

type Stage = "idle" | "bgremove" | "analyze";

function colorOf(it: ProductLibraryItem | SharedLibraryItem): string | null {
  const s = it as SharedLibraryItem;
  if (s.colors && s.colors.length) return s.colors[0];
  return (it as any).color ?? null;
}
function materialOf(it: ProductLibraryItem | SharedLibraryItem): string | null {
  const m = (it as any).material;
  if (Array.isArray(m)) return m[0] ?? null;
  return m ?? null;
}

export function AddItem({ onClose }: { onClose: () => void }) {
  const { loading: authLoading } = useAuth();
  const analyze = useServerFn(analyzeWardrobeImage);
  const fetchLocations = useServerFn(listLocations);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  
  const importUrl = useServerFn(importProductFromUrl);
  const downloadImage = useServerFn(downloadImportImage);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchLocations()
      .then((res) => setActiveLocationId(res.activeLocationId))
      .catch((e) => console.error("[AURA add-item] active location lookup failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"capture" | "url" | "library" | "details">("capture");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [err, setErr] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [searchingByPhoto, setSearchingByPhoto] = useState(false);
  const [altImages, setAltImages] = useState<string[]>([]);
  const [altLoading, setAltLoading] = useState<string | null>(null);
  const [brokenAltImages, setBrokenAltImages] = useState<Record<string, boolean>>({});
  const [importReferer, setImportReferer] = useState<string>("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryResults, setLibraryResults] = useState<ProductLibraryItem[]>([]);
  const [sharedResults, setSharedResults] = useState<SharedLibraryItem[]>([]);
  const [librarySearching, setLibrarySearching] = useState(false);

  const [libraryLoadingId, setLibraryLoadingId] = useState<string | null>(null);
  const [libraryColumns, setLibraryColumns] = useState<2 | 3>(3);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterColor, setFilterColor] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterSeason, setFilterSeason] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [brand, setBrand] = useState("");
  const [detectedProductCode, setDetectedProductCode] = useState("");
  const [detectedManufacturer, setDetectedManufacturer] = useState("");
  const [size, setSize] = useState("");
  const [category, setCategory] = useState("Tops");
  const [subcategory, setSubcategory] = useState("");
  const [length, setLength] = useState("");
  const [sleeveLength, setSleeveLength] = useState("");
  const [fit, setFit] = useState("");
  const [heelHeight, setHeelHeight] = useState("");
  const [toeShape, setToeShape] = useState("");
  const [closure, setClosure] = useState("");
  const [gender, setGender] = useState("");
    const [styleTags, setStyleTags] = useState<string[]>([]);
  const [formality, setFormality] = useState<number | null>(null);
  const [dayEvening, setDayEvening] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [composition, setComposition] = useState<CompositionEntry[]>([]);

  const resetFields = () => {
    setBrand(""); setSize(""); setCategory("Tops"); setSubcategory(""); setColors([]);
    setLength(""); setSleeveLength(""); setFit(""); setHeelHeight(""); setToeShape("");
        setClosure(""); setGender(""); setStyleTags([]);
    setFormality(null); setDayEvening("");
    setSeasons([]); setStyles([]); setOccasions([]); setMaterials([]);
    setPrice(""); setCurrency("EUR"); setComposition([]);
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setDetectedProductCode(""); setDetectedManufacturer("");
  };

    const runPipeline = async (initialFile: File, opts?: {
    brand?: string; source?: "photo" | "url" | "library"; price?: string; currency?: string;
    materials?: string[]; composition?: CompositionEntry[]; productId?: string;
    category?: string; subcategory?: string; colors?: string[]; season?: string;
  }) => {

    const compressedFile = await compressImageForUpload(initialFile);
    setFile(compressedFile);
    setPreview(URL.createObjectURL(compressedFile));
    setTransparent(false);
    setStep("details");
    resetFields();
    if (opts?.brand) setBrand(opts.brand);
    if (opts?.price) setPrice(opts.price);
    if (opts?.currency) setCurrency(opts.currency);
    if (opts?.materials?.length) setMaterials(opts.materials);
    if (opts?.composition?.length) setComposition(opts.composition);
    if (opts?.category) setCategory(opts.category);
    if (opts?.subcategory) setSubcategory(opts.subcategory);
    if (opts?.colors?.length) setColors(opts.colors);
    if (opts?.season) setSeasons([opts.season]);
    setSelectedProductId(opts?.productId ?? null);

    const dataUrl = await readFileAsDataUrl(compressedFile);

    // Background removal does NOT run here anymore. It used to fire the
    // moment a photo was captured/picked — before the person had even
    // decided this was the photo they wanted to keep — burning a WASM
    // pass (and, on multi-candidate URL imports, one pass per candidate
    // never used) for nothing. It now runs once, in save(), right before
    // upload — same principle as batch scan, where background removal is
    // an explicit step, never automatic on capture.
    setStage("analyze");
    const fromLibrary = opts?.source === "library";
    await analyze({ data: { imageDataUrl: dataUrl } })
      .then(result => {
        if (result.category && !fromLibrary) setCategory(result.category);
        if (result.subcategory && !fromLibrary) setSubcategory(result.subcategory);
        if (result.length) setLength(result.length);
        if (result.sleeveLength) setSleeveLength(result.sleeveLength);
        if (result.fit) setFit(result.fit);
        if (result.heelHeight) setHeelHeight(result.heelHeight);
        if (result.toeShape) setToeShape(result.toeShape);
        if (result.closure) setClosure(result.closure);
        if (result.gender) setGender(result.gender);
                if (result.styleTags?.length) setStyleTags(result.styleTags);
        if (result.formality != null) setFormality(result.formality);
        if (result.dayEvening) setDayEvening(result.dayEvening);
                if (result.colors?.length && !fromLibrary) setColors(result.colors);
        if (result.styles?.length) setStyles(result.styles);
        if (result.occasions?.length) setOccasions(result.occasions);
        if (result.seasons?.length) setSeasons(result.seasons);
        if (!opts?.materials?.length && result.materials?.length) setMaterials(result.materials);
        if (result.brand && !opts?.brand) setBrand(result.brand);
        setDetectedProductCode(result.detectedProductCode ?? "");
        setDetectedManufacturer(result.detectedManufacturer ?? "");
      })
      .catch(e => console.warn("[AURA] AI analysis failed", e));
    setStage((s) => (s === "analyze" ? "idle" : s));
  };

  const onPick = async (f: File | null) => {
    if (!f) return;
    if (!isImageFile(f)) { toast.error("Please select an image"); return; }
    setAltImages([]);
    await runPipeline(f);
  };
  const handleImportUrl = async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    let parsed: URL;
    try { parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`); }
    catch { toast.error("Please enter a valid URL"); return; }

    setImporting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const result = await importUrl({
        data: { url: parsed.toString(), accessToken: sess.session?.access_token },
      });
      if (!result.ok) { toast.error(result.error); return; }
      setAltImages(result.imageCandidates ?? []);
      setImportReferer(parsed.origin);
      const raw = await dataUrlToFile(result.imageDataUrl, `import-${Date.now()}.jpg`);
      const file = await normalizeForPipeline(raw);
      await runPipeline(file, {
        brand: result.brand || undefined,
        source: "url",
        price: result.priceValue != null ? String(result.priceValue) : undefined,
        currency: result.priceCurrency || undefined,
        materials: result.materials?.length ? result.materials : undefined,
        composition: result.composition?.length ? result.composition : undefined,
      });
      if (result.title) toast.message(result.title, { description: result.price ?? undefined });
      if (result.confidence === "low") {
        toast.message("Double-check the photo", {
          description: "We couldn't verify this image against the product page — make sure it's the right piece.",
        });
      }
      if (result.colorWarning) {
        toast.message("Check the color", { description: result.colorWarning });
      }
      // TEMP DIAGNOSTIC (2026-08-18): shows whether the top-scored image
      // (debugTopScoredUrl) is the one that actually got used
      // (debugPickedUrl) or whether its download silently failed and a
      // lower-scored candidate won instead. Remove once the Zara
      // photo-selection issue is confirmed fixed or root-caused.
      {
        const r = result as unknown as {
          debugTopScoredUrl?: string;
          debugPickedUrl?: string;
          debugDownloadAttempts?: Array<{ url: string; ok: boolean; error?: string }>;
        };
        const top = r.debugTopScoredUrl?.split("/").pop()?.slice(0, 50) ?? "?";
        const picked = r.debugPickedUrl?.split("/").pop()?.slice(0, 50) ?? "?";
        const sameWon = r.debugTopScoredUrl === r.debugPickedUrl;
        const failures = (r.debugDownloadAttempts ?? [])
          .filter((a) => !a.ok)
          .map((a) => `✗ ${a.url.split("/").pop()?.slice(0, 40)}: ${a.error?.slice(0, 40)}`)
          .join("\n");
        toast.message(sameWon ? "DEBUG: top-scored image WON" : "DEBUG: top-scored image LOST", {
          description: `top: ${top}\npicked: ${picked}${failures ? `\n\nfailures:\n${failures}` : ""}`,
          duration: 20000,
        });
      }
    } catch (e) {
      console.error("[AURA import-url]", e);
      toast.error("Could not import from that URL");
    } finally {
      setImporting(false);
    }
  };

  /** Ricerca testuale — nessun upload, nessuna chiamata di rete: apre
   *  Google con una query costruita dai dati più specifici disponibili.
   *  Il codice prodotto letto dall'etichetta (se presente) è il termine più
   *  affidabile — vince su categoria/colore. Il brand, se non visibile come
   *  logo, può comunque venire dal nome del produttore stampato
   *  sull'etichetta (es. "Tessilform S.p.A." per Patrizia Pepe) — non è lo
   *  stesso concetto, ma è meglio di nessun termine identificativo. */
  const handleSearchGoogle = () => {
    const query = buildProductSearchQuery({
      productCode: detectedProductCode,
      brand: brand || detectedManufacturer,
      subcategory,
      category,
      color: colors[0],
    });
    if (!query) { toast.error("Add a brand or category first so we know what to search for."); return; }
    window.open(buildGoogleSearchUrl(query), "_blank", "noopener,noreferrer");
  };

  /** Ricerca per immagine (Google Lens) — richiede un URL pubblico
   *  raggiungibile da Google, quindi la foto corrente va prima caricata su
   *  uno storage path temporaneo e firmata con un signed URL a breve
   *  scadenza (mai il path permanente, per non lasciare in giro link
   *  validi a lungo termine a una foto privata dell'utente). */
  const handleSearchByPhoto = async () => {
    if (!file) { toast.error("Take or choose a photo first."); return; }
    setSearchingByPhoto(true);
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr || !auth?.user?.id) throw new Error("You must be signed in to search by photo.");
      const uid = auth.user.id;

      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const tmpPath = `${uid}/tmp-search/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(tmpPath, file, {
        cacheControl: "60", upsert: false, contentType: file.type || "image/jpeg",
      });
      if (upErr) throw upErr;

      // 10 minuti: il tempo che serve a Google per recuperare l'immagine,
      // non un secondo di più — è la stessa logica di breve scadenza già
      // usata altrove nel progetto per i link di condivisione temporanei.
      const { data: signed, error: signErr } = await supabase.storage
        .from("wardrobe")
        .createSignedUrl(tmpPath, 600);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Could not sign the image URL.");

      window.open(buildGoogleLensUrl(signed.signedUrl), "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[AURA search-by-photo]", e);
      toast.error("Could not start the photo search. Please try again.");
    } finally {
      setSearchingByPhoto(false);
    }
  };

  const handleSelectProduct = async (p: ProductLibraryItem) => {
    if (libraryLoadingId) return;
    if (!p.canonical_image_url) { toast.error("This entry has no photo yet — add the item manually."); return; }
    setLibraryLoadingId(p.id);
    try {
      const res = await downloadImage({ data: { url: p.canonical_image_url } });
      if (!res.ok) { toast.error(res.error); return; }
      const rawF = await dataUrlToFile(res.imageDataUrl, `library-${Date.now()}.jpg`);
      const f = await normalizeForPipeline(rawF);
      await runPipeline(f, {
        brand: p.brand || undefined,
        source: "library",
        productId: p.id,
        category: p.category || undefined,
        subcategory: p.subcategory || undefined,
        colors: p.color ? [p.color] : undefined,
        season: p.season || undefined,
        materials: p.material ? [p.material] : undefined,
      });
      toast.message("Loaded from the AURA Library", { description: "Double-check the details before saving." });
    } catch (e) {
      console.error("[AURA product-library] select failed", e);
      toast.error("Could not load that product");
    } finally {
      setLibraryLoadingId(null);
    }
  };

  /** Importa un capo dalla libreria condivisa: crea una riga INDIPENDENTE nel
   *  guardaroba dell'importatore. Copia solo i campi prodotto; i campi
   *  personali (worn_count, last_worn, purchase_date, location_id) restano ai
   *  default. Price/size arrivano pre-compilati ma restano editabili. */
  const handleSelectShared = async (s: SharedLibraryItem) => {
    if (libraryLoadingId) return;
    if (!s.signed_url) { toast.error("This entry has no photo available."); return; }
    setLibraryLoadingId(s.id);
    try {
      const res = await downloadImage({ data: { url: s.signed_url } });
      if (!res.ok) { toast.error(res.error); return; }
      const rawF = await dataUrlToFile(res.imageDataUrl, `shared-${Date.now()}.jpg`);
      const f = await normalizeForPipeline(rawF);
      await runPipeline(f, {
        brand: s.brand || undefined,
        source: "library",
        category: s.category || undefined,
        subcategory: s.subcategory || undefined,
        colors: s.colors?.length ? s.colors : (s.color ? [s.color] : undefined),
        season: s.season || undefined,
        materials: s.material?.length ? s.material : undefined,
        price: s.price != null ? String(s.price) : undefined,
        currency: s.currency || undefined,
      });
      if (s.size) setSize(s.size);
      toast.message("Loaded from the shared library", { description: "Details are yours to edit before saving." });
    } catch (e) {
      console.error("[AURA shared-library] select failed", e);
      toast.error("Could not load that piece");
    } finally {
      setLibraryLoadingId(null);
    }
  };

  const runLibrarySearch = async () => {
    const q = libraryQuery.trim();
    if (!q) { setLibraryResults([]); setSharedResults([]); return; }
    setLibrarySearching(true);
    try {
      const [products, shared] = await Promise.all([
        searchProductLibrary(q),
        searchSharedLibrary({ data: { q } }).catch(() => [] as SharedLibraryItem[]),
      ]);
      setLibraryResults(products);
      setSharedResults(shared);
      setFilterCategory(""); setFilterColor(""); setFilterMaterial(""); setFilterBrand(""); setFilterSeason("");
    } finally {
      setLibrarySearching(false);
    }
  };

  const filterOptions = useMemo(() => {
    const cats = new Set<string>();
    const cols = new Set<string>();
    const mats = new Set<string>();
    const brands = new Set<string>();
    const seasonsSet = new Set<string>();
    for (const it of [...sharedResults, ...libraryResults]) {
      const cat = (it as any).category as string | null;
      if (cat) cats.add(cat);
      const col = colorOf(it);
      if (col) cols.add(col);
      const mat = materialOf(it);
      if (mat) mats.add(mat);
      const br = (it as any).brand as string | null;
      if (br) brands.add(br);
      const se = (it as any).season as string | null;
      if (se) seasonsSet.add(se);
    }
    return {
      categories: Array.from(cats).sort(),
      colors: Array.from(cols).sort(),
      materials: Array.from(mats).sort(),
      brands: Array.from(brands).sort(),
      seasons: Array.from(seasonsSet).sort(),
    };
  }, [sharedResults, libraryResults]);

  const matchesFilters = (it: ProductLibraryItem | SharedLibraryItem) => {
    if (filterCategory && (it as any).category !== filterCategory) return false;
    if (filterColor && colorOf(it) !== filterColor) return false;
    if (filterMaterial && materialOf(it) !== filterMaterial) return false;
    if (filterBrand && (it as any).brand !== filterBrand) return false;
    if (filterSeason && (it as any).season !== filterSeason) return false;
    return true;
  };
  const filteredShared = sharedResults.filter(matchesFilters);
  const filteredProducts = libraryResults.filter(matchesFilters);


  const useAltImage = async (url: string) => {
    if (altLoading) return;
    setAltLoading(url);
    try {
      const res = await downloadImage({ data: { url, referer: importReferer || undefined } });
      if (!res.ok) { toast.error(res.error); return; }
      const rawF = await dataUrlToFile(res.imageDataUrl, `import-${Date.now()}.jpg`);
      const f = await normalizeForPipeline(rawF);
      await runPipeline(f, {
        brand: brand || undefined,
        source: "url",
        price: price || undefined,
        currency,
        materials: materials.length ? materials : undefined,
        composition: composition.length ? composition : undefined,
      });
    } catch (e) {
      console.error("[AURA import-alt]", e);
      toast.error("Could not load that photo");
    } finally {
      setAltLoading(null);
    }
  };

    const toggle = (values: string[], setter: (next: string[]) => void, value: string) =>
    setter(values.includes(value) ? values.filter((x) => x !== value) : [...values, value]);

  const toggleSeason = (values: string[], setter: (next: string[]) => void, value: string) => {
    if (value === "All Seasons") {
      setter(values.includes(value) ? [] : ["All Seasons"]);
    } else {
      const withoutAll = values.filter((x) => x !== "All Seasons");
      setter(withoutAll.includes(value) ? withoutAll.filter((x) => x !== value) : [...withoutAll, value]);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void onPick(event.dataTransfer.files?.[0] ?? null);
  };

  const save = async () => {
    if (!file) return;
    setSaving(true); setErr(null);
    try {
      // Background removal runs here — right before upload, once, on the
      // photo the person actually decided to keep — not the moment it was
      // captured/picked. Skip it if it already ran (e.g. a retry after a
      // failed save shouldn't burn a second WASM pass on the same file).
      let fileToSave = file;
      if (!transparent) {
        setStage("bgremove");
        try {
          const targetDataUrl = await readFileAsDataUrl(file);
          let bg = await removeBackgroundClient(targetDataUrl);
          let attempt = 1;
          while (!bg.ok && attempt < 3) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            bg = await removeBackgroundClient(targetDataUrl);
            attempt++;
          }
          if (bg.ok) {
            const { file: cleanFile, isTransparent } = await ensureTransparentPng(
              bg.imageDataUrl,
              `item-${Date.now()}.png`,
            );
            fileToSave = cleanFile;
            setFile(cleanFile);
            setPreview(URL.createObjectURL(cleanFile));
            setTransparent(isTransparent);
          } else {
            toast.message("Background not removed", { description: bg.error });
          }
        } catch (e) {
          console.warn("[AURA] bg removal failed", e);
        } finally {
          setStage((s) => (s === "bgremove" ? "idle" : s));
        }
      }

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr || !auth?.user?.id) throw new Error("You must be signed in to add a piece.");
      const uid = auth.user.id;

      const trimmedFile = await trimFileMargins(fileToSave);
      const isPng = trimmedFile.type === "image/png";
      const ext = isPng ? "png" : (trimmedFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg");
      const path = `${uid}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(path, trimmedFile, {
        cacheControl: "3600", upsert: false, contentType: trimmedFile.type || "image/png",
      });
      if (upErr) throw upErr;

      // A separate, much smaller copy just for grid views — the closet
      // grid was loading dozens of full-size images at once, which is
      // the actual bottleneck; the detail view still uses the full file.
      let thumbnailPath: string | null = null;
      try {
        const thumbFile = await compressImageForUpload(trimmedFile, 400, 0.75);
        const thumbPath = `${uid}/thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { error: thumbErr } = await supabase.storage.from("wardrobe").upload(thumbPath, thumbFile, {
          cacheControl: "3600", upsert: false, contentType: thumbFile.type || "image/jpeg",
        });
        if (!thumbErr) thumbnailPath = thumbPath;
      } catch (e) {
        console.error("[AURA add-item] thumbnail generation failed, grid will use the full image", e);
      }

      const payload: TablesInsert<"wardrobe_items"> & { thumbnail_path?: string | null } = {
        user_id: uid,
        image_url: path,
        thumbnail_path: thumbnailPath,
        category: categories.includes(category) ? category : "Tops",
        subcategory: subcategoriesFor(category).includes(subcategory) ? subcategory : null,
        brand: brand.trim() || null,
        color: colors[0] ?? null,
        colors,
        season: seasons.filter((s) => seasonOptions.includes(s)).join(", ") || null,
        style: styles.filter((s) => styleOptions.includes(s)).join(", ") || null,
        occasion: occasions.filter((o) => occasionOptions.includes(o)).join(", ") || null,
        material: materials.filter((m) => materialOptions.includes(m)),
        price: (() => {
          const n = parseFloat(price.replace(",", "."));
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        currency: price.trim() ? currency : null,
        size: size.trim() || null,
      };
      const compositionToSave = composition.filter((c) => materials.includes(c.material));
      const fullPayload = {
        ...payload,
        composition: compositionToSave.length ? compositionToSave : null,
        length: length || null,
        sleeve_length: sleeveLength || null,
        fit: fit || null,
        heel_height: heelHeight || null,
        toe_shape: toeShape || null,
        closure: closure || null,
                gender: gender || null,
        style_tags: styleTags,
                formality: formality,
        day_evening: dayEvening || null,
        purchase_date: purchaseDate || null,
               location_id: activeLocationId,
        product_id: selectedProductId,
      } as unknown as TablesInsert<"wardrobe_items">;
      let { data: inserted, error: insErr } = await supabase
        .from("wardrobe_items").insert(fullPayload).select("*").single();
      if (insErr && /column .* does not exist|composition/i.test(String(insErr.message))) {
        console.warn("[AURA wardrobe] new column not in cache yet — saving without extended attributes", insErr.message);
        ({ data: inserted, error: insErr } = await supabase
          .from("wardrobe_items").insert(payload as never).select("*").single());
      }
      if (insErr) throw insErr;
      toast.success("Added to your closet");
      void syncMySharedLibrary().catch(() => {});
      window.dispatchEvent(new CustomEvent("aura:wardrobe-item-created", { detail: inserted }));
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "Failed to save wardrobe item.");
      console.error("[AURA wardrobe] save failed", e);
      setErr(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const stageLabel =
    stage === "bgremove" ? "Cleaning up image…" :
    stage === "analyze"  ? "Analyzing your item…" :
    "AI suggestions ready · edit anything";

  return (
    <div className="absolute inset-0 z-50 bg-background animate-slide-up flex flex-col">
      <header className="flex items-center justify-between px-6 pt-14 pb-3">
        <button onClick={onClose} aria-label="Close add item" className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <h1 className="font-serif text-lg italic">Add a New Piece</h1>
        <div className="w-10" />
      </header>

      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {step === "capture" ? (
        <div className="flex-1 flex flex-col px-6 pb-10">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="relative flex-1 rounded-[2rem] overflow-hidden bg-gradient-to-br from-[oklch(0.35_0.02_60)] to-[oklch(0.18_0.012_60)] mb-6"
          >
            <div className="absolute inset-0 grain opacity-30" />
            <div className="absolute inset-8 border border-white/20 rounded-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/60">
              <Sparkles size={28} className="mx-auto animate-float" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">Add a garment</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">tap to take a photo</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center">
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
                aria-label="Take photo"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
            </div>
          </div>

                    <button
            onClick={() => setStep("library")}
            className="mb-3 w-full h-14 rounded-full border border-foreground/15 bg-secondary/40 flex items-center justify-center gap-2 active:scale-[0.98] transition"
          >
            <Search size={16} />
            <span className="text-xs uppercase tracking-[0.3em]">Search the AURA Library</span>
          </button>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}

              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">Photo library</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">Choose file</span>
            </button>
            <button
              onClick={() => setStep("url")}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <LinkIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">Paste product link</span>
            </button>
          </div>
        </div>
            ) : step === "library" ? (
        <div className="flex-1 flex flex-col px-6 pb-10 animate-fade-in overflow-y-auto">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">AURA Library</p>
          <p className="font-serif text-2xl italic mt-2">Search known products</p>
          <p className="text-xs text-muted-foreground mt-2">
            Brand, type, material or description — we'll pre-fill the details from a match.
          </p>
          <div className="mt-5 rounded-full bg-background border border-border flex items-center px-4 py-2.5">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runLibrarySearch(); }}
              placeholder="e.g. Zara black blazer"
              className="flex-1 ml-2 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
          </div>
          <button
            onClick={runLibrarySearch}
            disabled={librarySearching || !libraryQuery.trim()}
            className="mt-4 w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] disabled:opacity-60"
          >
            {librarySearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
          <button
            onClick={() => setStep("capture")}
            className="mt-3 w-full h-10 rounded-full border border-border text-xs uppercase tracking-[0.3em]"
          >
            Back
          </button>

          {!librarySearching && libraryQuery.trim() && libraryResults.length === 0 && sharedResults.length === 0 && (
            <p className="mt-6 text-xs text-muted-foreground text-center">
              No match yet — add it manually and it'll enrich the Library for next time.
            </p>
          )}

          {!librarySearching && (libraryResults.length > 0 || sharedResults.length > 0) && filteredShared.length === 0 && filteredProducts.length === 0 && (
            <p className="mt-6 text-xs text-muted-foreground text-center">
              No results match these filters.
            </p>
          )}

          {(sharedResults.length > 0 || libraryResults.length > 0) && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Refine</p>
              <div className="shrink-0 flex items-center gap-1 rounded-full border border-border p-0.5">
                <button
                  onClick={() => setLibraryColumns(2)}
                  className={`rounded-full px-2.5 py-1 text-[10px] ${libraryColumns === 2 ? "bg-foreground text-background" : "text-muted-foreground"}`}
                >
                  2
                </button>
                <button
                  onClick={() => setLibraryColumns(3)}
                  className={`rounded-full px-2.5 py-1 text-[10px] ${libraryColumns === 3 ? "bg-foreground text-background" : "text-muted-foreground"}`}
                >
                  3
                </button>
              </div>
            </div>
          )}

          {(sharedResults.length > 0 || libraryResults.length > 0) && (
            <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">Category</option>
                {filterOptions.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={filterColor}
                onChange={(e) => setFilterColor(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">Color</option>
                {filterOptions.colors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">Material</option>
                {filterOptions.materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">Brand</option>
                {filterOptions.brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                value={filterSeason}
                onChange={(e) => setFilterSeason(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">Season</option>
                {filterOptions.seasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {(filterCategory || filterColor || filterMaterial || filterBrand || filterSeason) && (
                <button
                  onClick={() => { setFilterCategory(""); setFilterColor(""); setFilterMaterial(""); setFilterBrand(""); setFilterSeason(""); }}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {filteredShared.length > 0 && (
            <>
              <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Shared closet · anonymous
              </p>
              <div className={`mt-2 grid gap-1.5 ${libraryColumns === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                {filteredShared.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectShared(s)}
                    disabled={libraryLoadingId !== null}
                    className="rounded-xl border border-border bg-card overflow-hidden active:scale-[0.98] transition disabled:opacity-60"
                  >
                    <div className="aspect-square w-full bg-secondary/40 relative">
                      {s.signed_url && (
                        <img src={s.signed_url} alt="" loading="lazy" className="h-full w-full object-contain" />
                      )}
                      {libraryLoadingId === s.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                          <Loader2 size={14} className="animate-spin" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {filteredProducts.length > 0 && (
            <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">AURA Library</p>
          )}
          <div className={`mt-2 grid gap-1.5 ${libraryColumns === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectProduct(p)}
                disabled={libraryLoadingId !== null}
                className="rounded-xl border border-border bg-card overflow-hidden active:scale-[0.98] transition disabled:opacity-60"
              >
                <div className="aspect-square w-full bg-secondary/40 relative">
                  {p.canonical_image_url && (
                    <img src={p.canonical_image_url} alt="" loading="lazy" className="h-full w-full object-contain" />
                  )}
                  {libraryLoadingId === p.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 size={14} className="animate-spin" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : step === "url" ? (
        <div className="flex-1 flex flex-col px-6 pb-10 animate-fade-in">
          <div className="rounded-2xl bg-secondary/40 p-6">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Import from URL</p>

            <p className="font-serif text-2xl italic mt-2">Paste a product link</p>
            <p className="text-xs text-muted-foreground mt-2">
              Works with most fashion stores.
              We'll extract the product photo, clean it up and pre-fill the details.
            </p>
            <div className="mt-5 rounded-full bg-background border border-border flex items-center px-4 py-2.5">
              <LinkIcon size={14} className="text-muted-foreground shrink-0" />
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.zara.com/…"
                className="flex-1 ml-2 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
            </div>
            <button
              onClick={handleImportUrl}
              disabled={importing || !urlInput.trim()}
              className="mt-4 w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] disabled:opacity-60"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
              Import product
            </button>
            <button
              onClick={() => setStep("capture")}
              className="mt-3 w-full h-10 rounded-full border border-border text-xs uppercase tracking-[0.3em]"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-2xl overflow-hidden aspect-[4/5]"
            style={{ background: "#F5F5F5" }}
          >
            {preview && (
              <img
                src={preview}
                alt=""
                className={`h-full w-full ${transparent ? "object-contain p-4" : "object-cover"}`}
              />
            )}
          </div>

          {file && (detectedProductCode || detectedManufacturer) && (
            <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground text-center">
              Detected on label:{detectedProductCode ? ` code "${detectedProductCode}"` : ""}{detectedProductCode && detectedManufacturer ? " · " : ""}{detectedManufacturer ? detectedManufacturer : ""}
            </p>
          )}

          {file && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={handleSearchGoogle}
                className="h-11 rounded-full border border-foreground/15 bg-secondary/40 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest active:scale-95 transition"
              >
                <Search size={13} />
                Search on Google
              </button>
              <button
                onClick={() => void handleSearchByPhoto()}
                disabled={searchingByPhoto}
                className="h-11 rounded-full border border-foreground/15 bg-secondary/40 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest active:scale-95 transition disabled:opacity-60"
              >
                {searchingByPhoto ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                Search by photo
              </button>
            </div>
          )}

          {altImages.length > 1 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wrong photo? Pick another</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {altImages.map((u) => {
                  const broken = brokenAltImages[u];
                  if (broken) return null;
                  return (
                    <button
                      key={u}
                      onClick={() => void useAltImage(u)}
                      disabled={altLoading !== null}
                      className="relative h-20 w-16 shrink-0 rounded-xl overflow-hidden border border-border bg-secondary/40 active:scale-95 transition"
                      aria-label="Use this photo"
                    >
                      <img
                        src={u}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={() => setBrokenAltImages((prev) => ({ ...prev, [u]: true }))}
                      />
                      {altLoading === u && (
                        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                          <Loader2 size={14} className="animate-spin" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            {stage !== "idle" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            <span className="text-[10px] uppercase tracking-widest">{stageLabel}</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Brand" value={brand} onChange={setBrand} placeholder={stage === "analyze" ? "detecting…" : "leave empty if no logo"} />
            <Field
              label="Size"
              value={size}
              onChange={setSize}
              placeholder="e.g. 42 or M — optional"
              hint={sizeEquivalences(size, { shoes: isShoeCategory(category) }) ?? undefined}
            />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Price</p>
              <div className="mt-1 flex items-center gap-3">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="e.g. 129.90"
                  className="flex-1 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
                />
                <div className="flex gap-1.5">
                  {currencyOptions.map((c) => (
                    <button key={c} onClick={() => setCurrency(c)}
                      className={`rounded-full px-2.5 py-1 text-[10px] tracking-widest transition ${currency === c ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Powers cost-per-wear in the item card.</p>
            </div>
            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Purchase date</p>
              <input
                type="date"
                value={purchaseDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="mt-1 w-full bg-transparent font-serif text-lg outline-none"
              />
            </div>
            <ChipGroup
              label="Category"
              options={categories}
              value={category}
              onChange={(c) => {
                setCategory(c); setSubcategory("");
                setLength(""); setSleeveLength(""); setFit("");
                setHeelHeight(""); setToeShape(""); setClosure("");
              }}
            />
            {subcategoriesFor(category).length > 0 && (
              <ChipGroup
                label="Type"
                options={subcategoriesFor(category)}
                value={subcategory}
                onChange={(t) => { setSubcategory(t); setLength(""); }}
              />
            )}
            {lengthAppliesTo(category, subcategory) && (
              <ChipGroup label="Length" options={lengthOptionsFor(category, subcategory)} value={length} onChange={setLength} />
            )}
            {attributeAppliesTo("sleeveLength", category) && (
              <ChipGroup label="Sleeve" options={sleeveLengthOptions} value={sleeveLength} onChange={setSleeveLength} />
            )}
            {attributeAppliesTo("fit", category) && (
              <ChipGroup label="Fit" options={fitOptions} value={fit} onChange={setFit} />
            )}
            {attributeAppliesTo("heelHeight", category) && (
              <ChipGroup label="Heel" options={heelHeightOptions} value={heelHeight} onChange={setHeelHeight} />
            )}
            {attributeAppliesTo("toeShape", category) && (
              <ChipGroup label="Toe shape" options={toeShapeOptions} value={toeShape} onChange={setToeShape} />
            )}
            {attributeAppliesTo("closure", category) && (
              <ChipGroup label="Closure" options={closureOptions} value={closure} onChange={setClosure} />
            )}
            <ChipGroup label="Gender" options={genderOptions} value={gender} onChange={setGender} />
            <MultiChipGroup
              label="Style tags"
              options={styleTagOptions}
              values={styleTags}
              onToggle={(v: string) => toggle(styleTags, setStyleTags, v)}
            />
            <ColorPicker value={colors} onChange={setColors} />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Season</p>
              <div className="mt-2 flex flex-wrap gap-2">
                                {seasonOptions.map(s => {
                  const on = seasons.includes(s);
                  return (
                    <button key={s} onClick={() => toggleSeason(seasons, setSeasons, s)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {s}
                    </button>
                  );
                })}

              </div>
            </div>

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Formality</p>
              <p className="mt-1 text-[11px] text-muted-foreground">How dressed-up this piece reads — used to decide which occasions it's eligible for.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {FORMALITY_OPTIONS.map((label, i) => {
                  const level = i + 1;
                  const on = formality === level;
                  return (
                    <button key={label} onClick={() => setFormality(level)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Day / Evening</p>
              <p className="mt-1 text-[11px] text-muted-foreground">When it's actually worn — a piece missing this never shows up in outfit or trip suggestions at all.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DAY_EVENING_OPTIONS.map(({ value, label }) => {
                  const on = dayEvening === value;
                  return (
                    <button key={value} onClick={() => setDayEvening(value)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <MultiChipGroup label="Style" options={styleOptions} values={styles} onToggle={(v: string) => toggle(styles, setStyles, v)} />
            <MultiChipGroup label="Occasion" options={occasionOptions} values={occasions} onToggle={(v: string) => toggle(occasions, setOccasions, v)} />
            <MaterialCombobox label="Material" options={materialOptions} values={materials} onChange={setMaterials} />
            {composition.length > 0 && (
              <p className="text-[11px] text-muted-foreground -mt-1">
                Composition: {composition.map((c) => (c.pct != null ? `${c.pct}% ${c.material}` : c.material)).join(" · ")}
              </p>
            )}
          </div>

          {err && <p className="mt-4 text-xs text-red-700">{err}</p>}

          <button
            onClick={save}
            disabled={saving || authLoading}
            className="mt-8 w-full h-14 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span className="text-xs uppercase tracking-[0.3em]">Save to closet</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChipGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o}
            onClick={() => onChange(o)}
            className={`rounded-full px-3 py-1.5 text-xs transition ${value === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}

function MultiChipGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => {
          const on = values.includes(o);
          return (
            <button key={o}
              onClick={() => onToggle(o)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}
            >{o}</button>
          );
        })}
      </div>
    </div>
  );
}
