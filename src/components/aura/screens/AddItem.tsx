  return (
    <div className="absolute inset-0 z-50 bg-background animate-slide-up flex flex-col">
      <header className="flex items-center justify-between px-6 pt-14 pb-3">
        <button onClick={onClose} aria-label={t("addItem.closeAria")} className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <h1 className="font-serif text-lg italic">{t("addItem.headerTitle")}</h1>
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
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">{t("addItem.addGarment")}</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">{t("addItem.tapToTakePhoto")}</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center">
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
                aria-label={t("addItem.takePhotoAria")}
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
            <span className="text-xs uppercase tracking-[0.3em]">{t("addItem.searchLibraryButton")}</span>
          </button>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}

              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">{t("addItem.photoLibrary")}</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">{t("addItem.chooseFile")}</span>
            </button>
            <button
              onClick={() => setStep("url")}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <LinkIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">{t("addItem.pasteProductLink")}</span>
            </button>
          </div>
        </div>
            ) : step === "library" ? (
        <div className="flex-1 flex flex-col px-6 pb-10 animate-fade-in overflow-y-auto">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.auraLibrary")}</p>
          <p className="font-serif text-2xl italic mt-2">{t("addItem.searchKnownProducts")}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("addItem.libraryHint")}
          </p>
          <div className="mt-5 rounded-full bg-background border border-border flex items-center px-4 py-2.5">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runLibrarySearch(); }}
              placeholder={t("addItem.libraryPlaceholder")}
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
            {t("addItem.searchButton")}
          </button>
          <button
            onClick={() => setStep("capture")}
            className="mt-3 w-full h-10 rounded-full border border-border text-xs uppercase tracking-[0.3em]"
          >
            {t("addItem.back")}
          </button>

          {!librarySearching && libraryQuery.trim() && libraryResults.length === 0 && sharedResults.length === 0 && (
            <p className="mt-6 text-xs text-muted-foreground text-center">
              {t("addItem.noMatchYet")}
            </p>
          )}

          {!librarySearching && (libraryResults.length > 0 || sharedResults.length > 0) && filteredShared.length === 0 && filteredProducts.length === 0 && (
            <p className="mt-6 text-xs text-muted-foreground text-center">
              {t("addItem.noResultsMatchFilters")}
            </p>
          )}

          {(sharedResults.length > 0 || libraryResults.length > 0) && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.refine")}</p>
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
                <option value="">{t("addItem.categoryLabel")}</option>
                {filterOptions.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={filterColor}
                onChange={(e) => setFilterColor(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">{t("addItem.colorLabel")}</option>
                {filterOptions.colors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={filterMaterial}
                onChange={(e) => setFilterMaterial(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">{t("addItem.materialLabel")}</option>
                {filterOptions.materials.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">{t("addItem.brandLabel")}</option>
                {filterOptions.brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select
                value={filterSeason}
                onChange={(e) => setFilterSeason(e.target.value)}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px]"
              >
                <option value="">{t("addItem.seasonLabel")}</option>
                {filterOptions.seasons.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {(filterCategory || filterColor || filterMaterial || filterBrand || filterSeason) && (
                <button
                  onClick={() => { setFilterCategory(""); setFilterColor(""); setFilterMaterial(""); setFilterBrand(""); setFilterSeason(""); }}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground"
                >
                  {t("addItem.clear")}
                </button>
              )}
            </div>
          )}

          {filteredShared.length > 0 && (
            <>
              <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {t("addItem.sharedClosetAnonymous")}
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
            <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.auraLibrary")}</p>
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
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.importFromUrl")}</p>

            <p className="font-serif text-2xl italic mt-2">{t("addItem.pasteProductLinkTitle")}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("addItem.importUrlHint")}
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
              {t("addItem.importProduct")}
            </button>
            <button
              onClick={() => setStep("capture")}
              className="mt-3 w-full h-10 rounded-full border border-border text-xs uppercase tracking-[0.3em]"
            >
              {t("addItem.back")}
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
              {t("addItem.detectedOnLabel")}{detectedProductCode ? ` ${t("addItem.codeLabel")} "${detectedProductCode}"` : ""}{detectedProductCode && detectedManufacturer ? " · " : ""}{detectedManufacturer ? detectedManufacturer : ""}
            </p>
          )}

          {file && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={handleSearchGoogle}
                className="h-11 rounded-full border border-foreground/15 bg-secondary/40 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest active:scale-95 transition"
              >
                <Search size={13} />
                {t("addItem.searchOnGoogle")}
              </button>
              <button
                onClick={() => void handleSearchByPhoto()}
                disabled={searchingByPhoto}
                className="h-11 rounded-full border border-foreground/15 bg-secondary/40 flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest active:scale-95 transition disabled:opacity-60"
              >
                {searchingByPhoto ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
                {t("addItem.searchByPhoto")}
              </button>
            </div>
          )}

          {altImages.length > 1 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.wrongPhotoPickAnother")}</p>
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
                      aria-label={t("addItem.useThisPhotoAria")}
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
            <Field label={t("addItem.brandLabel")} value={brand} onChange={setBrand} placeholder={stage === "analyze" ? t("addItem.detecting") : t("addItem.leaveEmptyIfNoLogo")} />
            <Field
              label={t("addItem.sizeFieldLabel")}
              value={size}
              onChange={setSize}
              placeholder={t("addItem.sizePlaceholder")}
              hint={sizeEquivalences(size, { shoes: isShoeCategory(category) }) ?? undefined}
            />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.priceLabel")}</p>
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
              <p className="mt-1 text-[10px] text-muted-foreground">{t("addItem.priceHint")}</p>
            </div>
            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.purchaseDateLabel")}</p>
              <input
                type="date"
                value={purchaseDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="mt-1 w-full bg-transparent font-serif text-lg outline-none"
              />
            </div>
            <ChipGroup
              label={t("addItem.categoryLabel")}
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
                label={t("addItem.typeLabel")}
                options={subcategoriesFor(category)}
                value={subcategory}
                onChange={(t) => { setSubcategory(t); setLength(""); }}
              />
            )}
            {lengthAppliesTo(category, subcategory) && (
              <ChipGroup label={t("addItem.lengthLabel")} options={lengthOptionsFor(category, subcategory)} value={length} onChange={setLength} />
            )}
            {attributeAppliesTo("sleeveLength", category) && (
              <ChipGroup label={t("addItem.sleeveLabel")} options={sleeveLengthOptions} value={sleeveLength} onChange={setSleeveLength} />
            )}
            {attributeAppliesTo("fit", category) && (
              <ChipGroup label={t("addItem.fitLabel")} options={fitOptions} value={fit} onChange={setFit} />
            )}
            {attributeAppliesTo("heelHeight", category) && (
              <ChipGroup label={t("addItem.heelLabel")} options={heelHeightOptions} value={heelHeight} onChange={setHeelHeight} />
            )}
            {attributeAppliesTo("toeShape", category) && (
              <ChipGroup label={t("addItem.toeShapeLabel")} options={toeShapeOptions} value={toeShape} onChange={setToeShape} />
            )}
            {attributeAppliesTo("closure", category) && (
              <ChipGroup label={t("addItem.closureLabel")} options={closureOptions} value={closure} onChange={setClosure} />
            )}
            <ChipGroup label={t("addItem.genderLabel")} options={genderOptions} value={gender} onChange={setGender} />
            <MultiChipGroup
              label={t("addItem.styleTagsLabel")}
              options={styleTagOptions}
              values={styleTags}
              onToggle={(v: string) => toggle(styleTags, setStyleTags, v)}
            />
            <ColorPicker value={colors} onChange={setColors} />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.seasonLabel")}</p>
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
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.formalityLabel")}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("addItem.formalityHint")}</p>
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
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("addItem.dayEveningLabel")}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("addItem.dayEveningHint")}</p>
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

            <MultiChipGroup label={t("addItem.styleLabel")} options={styleOptions} values={styles} onToggle={(v: string) => toggle(styles, setStyles, v)} />
            <MultiChipGroup label={t("addItem.occasionLabel")} options={occasionOptions} values={occasions} onToggle={(v: string) => toggle(occasions, setOccasions, v)} />
            <MaterialCombobox label={t("addItem.materialLabel")} options={materialOptions} values={materials} onChange={setMaterials} />
            {composition.length > 0 && (
              <p className="text-[11px] text-muted-foreground -mt-1">
                {t("addItem.compositionLabel")} {composition.map((c) => (c.pct != null ? `${c.pct}% ${c.material}` : c.material)).join(" · ")}
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
            <span className="text-xs uppercase tracking-[0.3em]">{t("addItem.saveToCloset")}</span>
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
