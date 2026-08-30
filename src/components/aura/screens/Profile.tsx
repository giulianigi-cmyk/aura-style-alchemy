import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon, Share2, ChevronRight, LogOut, Pencil, Check, X, Camera, Loader2, User, Info, QrCode } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { WeatherPanel } from "../WeatherPanel";
import { MyBrands } from "../MyBrands";
import { supabase } from "@/integrations/supabase/client";
import { AvatarCropper } from "../AvatarCropper";
import { USERNAME_RE } from "@/lib/community";
import { AURA_APP_URL, nativeShareText } from "@/lib/aura-share";
import { QrFullscreen } from "../MyQrCode";
import { ProfileSocial } from "../ProfileSocial";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";


const STYLES = [
  "Minimal", "Editorial", "Quiet luxury", "Parisian", "Street",
  "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage", "Avant-garde", "Coastal",
];
const BRANDS = [
  "The Row", "Toteme", "Khaite", "Lemaire", "Jacquemus", "Loewe",
  "Bottega Veneta", "Celine", "Hermès", "Prada", "Chloé", "Acne Studios",
  "Saint Laurent", "Massimo Dutti", "COS", "Aritzia",
];
const GENDERS = ["Woman", "Man", "Prefer not to say"];
const INDUSTRIES = [
  "Finance / Legal", "Consulting / Corporate", "Tech / Startup",
  "Fashion / Creative", "Healthcare", "Education", "Hospitality / Retail",
  "Media / Marketing", "Public sector", "Other",
];
const WORK_DRESS_CODES = ["None", "Casual", "Smart Casual", "Business Casual", "Business Formal", "Uniform"];
const PERSONAL_FORMALITY = ["Very casual", "Casual", "Smart Casual", "Elegant", "Very elegant"];
const STYLE_BOLDNESS = ["Classic", "Balanced", "Creative", "Bold"];
const WEEKDAYS: { code: string; label: string }[] = [
  { code: "MO", label: "Mon" }, { code: "TU", label: "Tue" }, { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" }, { code: "FR", label: "Fri" }, { code: "SA", label: "Sat" }, { code: "SU", label: "Sun" },
];


const DRESS_CODE_DEFINITIONS: { term: string; description: string }[] = [
  { term: "None", description: "No specific dress code — wear whatever you like." },
  { term: "Casual", description: "Relaxed everyday clothes: jeans, t-shirts, sneakers." },
  { term: "Smart Casual", description: "Neat and put-together without being formal — chinos, blouses, loafers." },
  { term: "Business Casual", description: "Professional but relaxed — no tie needed, but polished (dress pants, collared shirts)." },
  { term: "Business Formal", description: "Fully professional — suits, blazers, structured tailoring." },
  { term: "Uniform", description: "A required uniform is provided or specified by the employer." },
];

const FORMALITY_DEFINITIONS: { term: string; description: string }[] = [
  { term: "Very casual", description: "Almost always in relaxed, comfortable clothing." },
  { term: "Casual", description: "Generally relaxed, dressed up only occasionally." },
  { term: "Smart Casual", description: "Put-together most days without going fully formal." },
  { term: "Elegant", description: "Prefers polished, refined outfits most of the time." },
  { term: "Very elegant", description: "Consistently dresses in a formal, elevated style." },
];

const STYLE_DEFINITIONS: { term: string; description: string }[] = [
  { term: "Minimal", description: "Clean lines, few colors, no clutter — quality over decoration." },
  { term: "Editorial", description: "Fashion-forward, styled like a magazine spread — bold silhouettes and combinations." },
  { term: "Quiet luxury", description: "Understated, high-quality basics with no visible logos." },
  { term: "Parisian", description: "Effortless, timeless French style — trench coats, striped tops, tailored basics." },
  { term: "Street", description: "Casual, urban-inspired — sneakers, oversized fits, streetwear brands." },
  { term: "Romantic", description: "Soft, feminine details — ruffles, florals, flowing fabrics." },
  { term: "Tailored", description: "Structured, fitted pieces — blazers, precise cuts." },
  { term: "Bohemian", description: "Free-spirited, textured, layered — prints, fringe, natural fabrics." },
  { term: "Sporty", description: "Athletic-inspired — activewear, sneakers, technical fabrics." },
  { term: "Vintage", description: "Inspired by past decades — retro cuts, patterns and details." },
  { term: "Avant-garde", description: "Experimental, unconventional shapes and combinations." },
  { term: "Coastal", description: "Relaxed, breezy, beach-inspired — linen, light colors, natural textures." },
];


const SHARING_DEFINITIONS = [
  { term: "What is shared", description: "Only the product side of each piece: brand, category, colours, materials, tags, size, price and an anonymous copy of the photo." },
  { term: "What is never shared", description: "Your name, account, city, how often you wear something, when you bought it and where you keep it. The link between a piece and you is replaced by an irreversible code held on the server." },
  { term: "Turning it off", description: "Your pieces disappear from future searches and the anonymous photo copies are deleted. Pieces other members already imported remain in their closet as independent copies — they are not removed." },
];

export function Profile({ go: _go, openConversation, openUserProfile }: { go: (s: Screen) => void; openConversation?: (id: string) => void; openUserProfile?: (id: string) => void }) {
  const { t } = useTranslation();
    const { user, signOut } = useAuth();
  const unreadCount = useUnreadNotifications();
  const [qrOpen, setQrOpen] = useState(false);
  const { profile, avatarUrl, loading, update, uploadAvatar } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [infoPopup, setInfoPopup] = useState<"style" | null>(null);
  const [profession, setProfession] = useState<string>("");
  const [bio, setBio] = useState<string>("");
    const [styles, setStyles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setProfession(profile.profession ?? "");
    setBio(profile.bio ?? "");
        setStyles(profile.style_preferences ?? []);
  }, [profile]);

  const toggle = (list: string[], setList: (v: string[]) => void,
