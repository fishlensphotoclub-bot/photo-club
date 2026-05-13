import { useState, useRef, useEffect } from "react";

// ─── Airtable config ──────────────────────────────────────────────
const AT_TOKEN  = "patcwuqVxd4W83mBj.46c35fa9bcc26690305cf4d43927a353f5210375b4322be7d47aeaac0a580384";
const AT_BASE   = "app3D6NUVB17eYK9W";
const AT_TABLE  = "Submissions";
const AT_URL    = `https://api.airtable.com/v0/${AT_BASE}/${AT_TABLE}`;
const AT_HEADS  = { "Authorization": `Bearer ${AT_TOKEN}`, "Content-Type": "application/json" };

// ─── Cloudinary config ────────────────────────────────────────────
const CLD_CLOUD  = "dtvvrilh3";
const CLD_PRESET = "u88d2paj";

async function compressImage(file, maxSizeMB = 8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        const maxDim = 2400;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        let quality = 0.85;
        const tryCompress = () => {
          canvas.toBlob((blob) => {
            if (blob.size <= maxSizeMB * 1024 * 1024 || quality < 0.3) {
              resolve(new File([blob], file.name, { type: "image/jpeg" }));
            } else {
              quality -= 0.1;
              tryCompress();
            }
          }, "image/jpeg", quality);
        };
        tryCompress();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToCloudinary(file) {
  const compressed = await compressImage(file);
  const formData = new FormData();
  formData.append("file", compressed);
  formData.append("upload_preset", CLD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLD_CLOUD}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error("Cloudinary upload failed");
  return data.secure_url;
}
// ─────────────────────────────────────────────────────────────────

async function fetchPhotos() {
  const res = await fetch(`${AT_URL}?sort[0][field]=Month&sort[0][direction]=desc`, { headers: AT_HEADS });
  const data = await res.json();
  if (!data.records) return [];
  return data.records.map(r => ({
    id:       r.id,
    title:    r.fields.Title    || "",
    author:   r.fields.Author   || "",
    note:     r.fields.Note     || "",
    url:      r.fields.ImageURL || "",
    month:    r.fields.Month    || "",
    feedback: r.fields.Feedback ? r.fields.Feedback.split("||").filter(Boolean) : [],
  }));
}

async function createPhoto(fields) {
  const res = await fetch(AT_URL, {
    method: "POST", headers: AT_HEADS,
    body: JSON.stringify({ fields: {
      Title: fields.title, Author: fields.author,
      Note: fields.note,   ImageURL: fields.url,
      Month: fields.month, Feedback: "",
    }}),
  });
  const data = await res.json();
  return { id: data.id, ...fields, feedback: [] };
}

async function addFeedbackRemote(photo, newComment) {
  const updated = [...photo.feedback, newComment].join("||");
  await fetch(`${AT_URL}/${photo.id}`, {
    method: "PATCH", headers: AT_HEADS,
    body: JSON.stringify({ fields: { Feedback: updated } }),
  });
}

async function deletePhotoRemote(id) {
  await fetch(`${AT_URL}/${id}`, { method: "DELETE", headers: AT_HEADS });
}

const THEMES = [
  { month: "May 2026", theme: "Shutter Speed", description: "Freeze a moment or blur the world in motion — show us what shutter speed can do.", color: "#e8a838" },
];

export default function App() {
  const [photos,       setPhotos]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [activeMonth,  setActiveMonth]  = useState("May 2026");
  const [view,         setView]         = useState("gallery");
  const [selected,     setSelected]     = useState(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [uploadStatus, setUploadStatus] = useState(""); // "", "uploading", "done"
  const [submitted,    setSubmitted]    = useState(false);
  const [form,         setForm]         = useState({ author: "", title: "", note: "", url: "" });
  const [previewUrl,   setPreviewUrl]   = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    fetchPhotos()
      .then(data => { setPhotos(data); setLoading(false); })
      .catch(() => { setError("Couldn't connect to Airtable. Check your credentials."); setLoading(false); });
  }, []);

  const currentTheme = THEMES.find(t => t.month === activeMonth) || THEMES[0];
  const filtered     = photos.filter(p => p.month === activeMonth);
  const accentColor  = currentTheme.color;

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = ev => setPreviewUrl(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!form.author || !form.title || (!selectedFile && !form.url)) return;
    setSubmitting(true);
    try {
      let imageUrl = form.url;
      if (selectedFile) {
        setUploadStatus("uploading");
        imageUrl = await uploadToCloudinary(selectedFile);
        setUploadStatus("done");
      }
      const newPhoto = await createPhoto({
        title: form.title, author: form.author,
        note: form.note,   url: imageUrl,
        month: THEMES[0].month,
      });
      setPhotos(prev => [newPhoto, ...prev]);
      setSubmitted(true);
      setForm({ author: "", title: "", note: "", url: "" });
      setPreviewUrl("");
      setSelectedFile(null);
      setUploadStatus("");
      setTimeout(() => { setSubmitted(false); setView("gallery"); setActiveMonth(THEMES[0].month); }, 2000);
    } catch {
      setUploadStatus("");
      alert("Submission failed. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFeedback(photo) {
    if (!feedbackText.trim()) return;
    const comment = feedbackText.trim();
    setFeedbackText("");
    const updated = { ...photo, feedback: [...photo.feedback, comment] };
    setPhotos(prev => prev.map(p => p.id === photo.id ? updated : p));
    setSelected(updated);
    await addFeedbackRemote(photo, comment);
  }

  async function handleDelete(photo) {
    if (!window.confirm(`Delete "${photo.title}"? This cannot be undone.`)) return;
    await deletePhotoRemote(photo.id);
    setPhotos(prev => prev.filter(p => p.id !== photo.id));
    setSelected(null);
  }

  const inputStyle = {
    width: "100%", background: "#111", border: "1px solid #2a2a2a",
    borderRadius: 3, color: "#f0ece3", padding: "12px 16px", fontSize: 14,
    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", color: "#f0ece3", fontFamily: "'Georgia','Times New Roman',serif" }}>

      {/* Header */}
      <header style={{
        borderBottom: "1px solid #2a2a2a", padding: "28px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, background: "#0d0d0d", zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: "#666", marginBottom: 4 }}>Monthly Challenge</div>
          <div style={{ fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em" }}>Fisheye Photo Club</div>
        </div>
        <nav style={{ display: "flex", gap: 8 }}>
          {["gallery","submit"].map(v => (
            <button key={v} onClick={() => { setView(v); setSelected(null); }} style={{
              background: view === v ? accentColor : "transparent",
              color: view === v ? "#0d0d0d" : "#aaa",
              border: `1px solid ${view === v ? accentColor : "#333"}`,
              borderRadius: 3, padding: "8px 20px", fontSize: 13,
              letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: "pointer", transition: "all 0.2s",
            }}>
              {v === "gallery" ? "Gallery" : "+ Submit"}
            </button>
          ))}
        </nav>
      </header>

      {/* Month tabs */}
      {view === "gallery" && (
        <div style={{ borderBottom: "1px solid #1e1e1e", padding: "16px 40px", display: "flex", gap: 6, overflowX: "auto" }}>
          {THEMES.map(t => (
            <button key={t.month} onClick={() => { setActiveMonth(t.month); setSelected(null); }} style={{
              background: activeMonth === t.month ? t.color : "#181818",
              color: activeMonth === t.month ? "#0d0d0d" : "#888",
              border: `1px solid ${activeMonth === t.month ? t.color : "#2a2a2a"}`,
              borderRadius: 3, padding: "7px 16px", fontSize: 12,
              letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s",
            }}>{t.month}</button>
          ))}
        </div>
      )}

      <main style={{ padding: "40px", maxWidth: 1100, margin: "0 auto" }}>

        {loading && <div style={{ textAlign: "center", color: "#555", padding: "80px 0" }}>Loading gallery…</div>}
        {error   && <div style={{ textAlign: "center", color: "#c0392b", padding: "80px 0" }}>{error}</div>}

        {/* Gallery grid */}
        {!loading && !error && view === "gallery" && !selected && (
          <>
            <div style={{
              border: `1px solid ${accentColor}33`, borderLeft: `3px solid ${accentColor}`,
              borderRadius: 4, padding: "20px 28px", marginBottom: 40, background: `${accentColor}08`,
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: accentColor, marginBottom: 6 }}>{currentTheme.month} Theme</div>
                <div style={{ fontSize: 28, letterSpacing: "-0.02em", marginBottom: 6 }}>{currentTheme.theme}</div>
                <div style={{ color: "#999", fontSize: 14, maxWidth: 480 }}>{currentTheme.description}</div>
              </div>
              <div style={{ fontSize: 36, fontWeight: 300, color: accentColor, opacity: 0.3 }}>{filtered.length}</div>
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", color: "#555", padding: "80px 0", fontSize: 15 }}>
                No submissions yet for this month.<br />
                <span style={{ color: accentColor, cursor: "pointer" }} onClick={() => setView("submit")}>Be the first to submit →</span>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2 }}>
                {filtered.map(photo => (
                  <div key={photo.id} onClick={() => setSelected(photo)} style={{
                    cursor: "pointer", position: "relative", aspectRatio: "4/3", overflow: "hidden", background: "#111",
                  }}>
                    <img src={photo.url} alt={photo.title} style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.4s", display: "block" }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                    />
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 55%)",
                      display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 16,
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{photo.title}</div>
                      <div style={{ fontSize: 12, color: "#bbb" }}>{photo.author}</div>
                      <div style={{ fontSize: 11, color: accentColor, marginTop: 4 }}>{photo.feedback.length} comment{photo.feedback.length !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Detail view */}
        {!loading && !error && view === "gallery" && selected && (
          <div>
            <button onClick={() => setSelected(null)} style={{
              background: "none", border: "none", color: "#888", cursor: "pointer",
              fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 28, padding: 0,
            }}>← Back to Gallery</button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, alignItems: "start" }}>
              <img src={selected.url} alt={selected.title} style={{ width: "100%", borderRadius: 4, display: "block", maxHeight: 540, objectFit: "cover" }} />
              <div>
                <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: accentColor, marginBottom: 8 }}>{selected.month}</div>
                <div style={{ fontSize: 26, marginBottom: 4 }}>{selected.title}</div>
                <div style={{ color: "#888", fontSize: 14, marginBottom: 16 }}>by {selected.author}</div>
                {selected.note && (
                  <div style={{ color: "#bbb", fontSize: 14, lineHeight: 1.7, marginBottom: 28, borderLeft: "2px solid #2a2a2a", paddingLeft: 16 }}>
                    "{selected.note}"
                  </div>
                )}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#555", marginBottom: 14 }}>Feedback ({selected.feedback.length})</div>
                  {selected.feedback.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No feedback yet. Be the first!</div>}
                  {selected.feedback.map((f, i) => (
                    <div key={i} style={{ background: "#181818", border: "1px solid #222", borderRadius: 3, padding: "10px 14px", fontSize: 13, color: "#ccc", marginBottom: 8 }}>{f}</div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleFeedback(selected)}
                    placeholder="Leave a comment…"
                    style={{ flex: 1, background: "#181818", border: "1px solid #2a2a2a", borderRadius: 3, color: "#f0ece3", padding: "10px 14px", fontSize: 13, outline: "none" }}
                  />
                  <button onClick={() => handleFeedback(selected)} style={{
                    background: accentColor, border: "none", borderRadius: 3,
                    padding: "10px 18px", color: "#0d0d0d", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                  }}>Post</button>
                </div>
                <button onClick={() => handleDelete(selected)} style={{ background: "none", border: "1px solid #3a1a1a", borderRadius: 3, padding: "10px 18px", color: "#c0392b", fontSize: 12, cursor: "pointer", fontFamily: "inherit", marginTop: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>Delete Submission</button>
              </div>
            </div>
          </div>
        )}

        {/* Submit */}
        {view === "submit" && (
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: THEMES[0].color, marginBottom: 10 }}>{THEMES[0].month}</div>
            <div style={{ fontSize: 28, marginBottom: 6 }}>Submit Your Photo</div>
            <div style={{ color: "#777", fontSize: 14, marginBottom: 36 }}>
              This month's theme: <span style={{ color: THEMES[0].color }}>{THEMES[0].theme}</span>
            </div>

            {submitted ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: THEMES[0].color, fontSize: 18 }}>✓ Photo submitted! Taking you to the gallery…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {[{ key: "author", label: "Your Name", placeholder: "e.g. Margot L." }, { key: "title", label: "Photo Title", placeholder: "e.g. Harbor at Dusk" }].map(field => (
                  <div key={field.key}>
                    <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>{field.label}</div>
                    <input value={form[field.key]} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} placeholder={field.placeholder} style={inputStyle} />
                  </div>
                ))}

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Upload Photo</div>
                  <div onClick={() => fileRef.current.click()} style={{
                    border: `2px dashed ${previewUrl ? THEMES[0].color : "#2a2a2a"}`,
                    borderRadius: 4, padding: previewUrl ? 0 : "36px 24px",
                    textAlign: "center", cursor: "pointer", color: "#666", fontSize: 13,
                    overflow: "hidden", transition: "border-color 0.2s",
                  }}>
                    {previewUrl
                      ? <img src={previewUrl} alt="preview" style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block" }} />
                      : "Click to choose a file"}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
                  {selectedFile && (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                      Selected: {selectedFile.name}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Or paste an image URL</div>
                  <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://…" style={inputStyle} />
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Photographer's Note (optional)</div>
                  <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="Tell us about the shot — the moment, the light, what drew you to it…" rows={3}
                    style={{ ...inputStyle, resize: "vertical" }} />
                </div>

                {uploadStatus === "uploading" && (
                  <div style={{ fontSize: 13, color: THEMES[0].color }}>⏳ Uploading image…</div>
                )}

                <button onClick={handleSubmit} disabled={submitting} style={{
                  background: submitting ? "#555" : THEMES[0].color,
                  border: "none", borderRadius: 3, padding: "14px 28px",
                  color: "#0d0d0d", fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase",
                  cursor: submitting ? "default" : "pointer", fontFamily: "inherit", marginTop: 4,
                }}>
                  {uploadStatus === "uploading" ? "Uploading image…" : submitting ? "Submitting…" : "Submit Photo →"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
