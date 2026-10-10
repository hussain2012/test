import { useEffect, useRef, useState } from 'react';

const VIEW_SIZE = 320;
const OUTPUT_SIZE = 1200;

export default function ImageCropDialog({ file, onCancel, onApply, onError }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = () => {
      imageRef.current = image;
      const scale = Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight);
      setZoom(1);
      setOffset({
        x: (VIEW_SIZE - image.naturalWidth * scale) / 2,
        y: (VIEW_SIZE - image.naturalHeight * scale) / 2,
      });
      setReady(true);
    };
    image.onerror = () => onError(new Error('تعذر فتح الصورة المختارة'));
    image.src = source;
    return () => {
      URL.revokeObjectURL(source);
      image.onload = null;
      image.onerror = null;
    };
  }, [file, onError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = Math.min(0, Math.max(VIEW_SIZE - width, offset.x));
    const y = Math.min(0, Math.max(VIEW_SIZE - height, offset.y));
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.drawImage(image, x, y, width, height);
  }, [ready, zoom, offset]);

  const moveCrop = (event) => {
    if (!dragRef.current) return;
    const { startX, startY, x, y } = dragRef.current;
    setOffset({ x: x + event.clientX - startX, y: y + event.clientY - startY });
  };

  const finishCrop = async () => {
    const image = imageRef.current;
    if (!image || busy) return;
    setBusy(true);
    try {
      const scale = Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight) * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const x = Math.min(0, Math.max(VIEW_SIZE - width, offset.x));
      const y = Math.min(0, Math.max(VIEW_SIZE - height, offset.y));
      const output = document.createElement('canvas');
      output.width = OUTPUT_SIZE;
      output.height = OUTPUT_SIZE;
      const context = output.getContext('2d');
      if (!context) throw new Error('تعذر تجهيز الصورة المعدلة');
      context.drawImage(image, -x / scale, -y / scale, VIEW_SIZE / scale, VIEW_SIZE / scale, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob = await new Promise((resolve, reject) => output.toBlob((result) => result ? resolve(result) : reject(new Error('تعذر حفظ الصورة المعدلة')), 'image/jpeg', 0.92));
      const stem = file.name.replace(/\.[^.]+$/, '') || 'product-image';
      onApply(new File([blob], `${stem}-crop.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-crop-backdrop" role="presentation">
      <section className="image-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="image-crop-title" dir="rtl">
        <header><div><h2 id="image-crop-title">تحديد الجزء الظاهر</h2><p>اسحب الصورة لاختيار الجزء، وكبّرها عند الحاجة.</p></div><button type="button" className="image-crop-close" onClick={onCancel} aria-label="إغلاق">×</button></header>
        <div className="image-crop-stage">
          <canvas
            ref={canvasRef}
            width={VIEW_SIZE}
            height={VIEW_SIZE}
            className={ready ? 'ready' : ''}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { startX: event.clientX, startY: event.clientY, ...offset };
            }}
            onPointerMove={moveCrop}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
            aria-label="معاينة قص الصورة، اسحب لتغيير الجزء الظاهر"
          />
          {!ready && <span>جاري تحميل الصورة...</span>}
        </div>
        <label className="image-crop-zoom">تكبير الصورة<input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <footer><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>إلغاء</button><button type="button" className="primary" onClick={finishCrop} disabled={!ready || busy}>{busy ? 'جاري تجهيز الصورة...' : 'اعتماد القص'}</button></footer>
      </section>
    </div>
  );
}
