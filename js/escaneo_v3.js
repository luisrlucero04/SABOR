const $ = (id) => document.getElementById(id);

const dropZone = $("drop-zone");
const selectFilesButton = $("select-files");
const takePhotoButton = $("take-photo");
const fileInput = $("file-input");
const cameraInput = $("camera-input");
const filesSection = $("files-section");
const fileList = $("file-list");
const clearFilesButton = $("clear-files");
const processButton = $("process-button");
const processingSection = $("processing-section");
const processingTitle = $("processing-title");
const processingCounter = $("processing-counter");
const processingStatus = $("processing-status");
const progressFill = $("progress-fill");
const resultsSection = $("results-section");
const resultsContainer = $("results-container");

let selectedFiles = [];
let ocrWorker = null;
let lastResults = [];

selectFilesButton.addEventListener("click", () => fileInput.click());
takePhotoButton.addEventListener("click", () => cameraInput.click());
fileInput.addEventListener("change", e => { addFiles(e.target.files); fileInput.value = ""; });
cameraInput.addEventListener("change", e => { addFiles(e.target.files); cameraInput.value = ""; });
clearFilesButton.addEventListener("click", clearAll);
processButton.addEventListener("click", processAllFiles);

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    addFiles(e.dataTransfer.files);
});
dropZone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
    }
});

function clearAll() {
    selectedFiles = [];
    lastResults = [];
    renderFileList();
    resultsSection.classList.add("hidden");
    resultsContainer.innerHTML = "";
}

function addFiles(fileListObject) {
    for (const file of Array.from(fileListObject || [])) {
        if (!file.type.startsWith("image/")) continue;
        const duplicate = selectedFiles.some(f =>
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (!duplicate) selectedFiles.push(file);
    }
    renderFileList();
}

function renderFileList() {
    fileList.innerHTML = "";
    if (!selectedFiles.length) {
        filesSection.classList.add("hidden");
        return;
    }
    filesSection.classList.remove("hidden");
    selectedFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "file-item";
        const preview = document.createElement("img");
        preview.className = "file-preview";
        preview.alt = "Vista previa";
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.onload = () => URL.revokeObjectURL(url);

        const info = document.createElement("div");
        info.className = "file-info";
        const name = document.createElement("p");
        name.className = "file-name";
        name.textContent = file.name;
        const size = document.createElement("p");
        size.className = "file-size";
        size.textContent = formatFileSize(file.size);
        info.append(name, size);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-file";
        remove.textContent = "×";
        remove.title = "Eliminar archivo";
        remove.addEventListener("click", () => {
            selectedFiles.splice(index, 1);
            renderFileList();
        });
        item.append(preview, info, remove);
        fileList.appendChild(item);
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function processAllFiles() {
    if (!selectedFiles.length) return;
    processButton.disabled = true;
    processingSection.classList.remove("hidden");
    resultsSection.classList.remove("hidden");
    resultsContainer.innerHTML = "";
    lastResults = [];
    progressFill.style.width = "0%";

    try {
        await createOCRWorker();
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            processingCounter.textContent = `${i + 1} / ${selectedFiles.length}`;
            processingTitle.textContent = `Analizando ${file.name}`;
            try {
                const result = await processSingleImage(file);
                lastResults.push(result);
                renderResult(result, lastResults.length - 1);
            } catch (error) {
                console.error(`Error procesando ${file.name}:`, error);
                renderError(file, error);
            }
        }
    } catch (error) {
        console.error("Error inicializando OCR:", error);
        alert("No se pudo iniciar el sistema OCR. Revisa la consola del navegador.");
    } finally {
        await terminateOCRWorker();
        processingTitle.textContent = "Análisis terminado";
        processingStatus.textContent = "Todas las imágenes fueron procesadas.";
        progressFill.style.width = "100%";
        processButton.disabled = false;
    }
}

async function createOCRWorker() {
    if (ocrWorker) return;
    if (typeof Tesseract === "undefined") {
        throw new Error("Tesseract.js no está disponible. Comprueba la conexión o el script de Tesseract.");
    }
    processingStatus.textContent = "Cargando motor OCR...";
    ocrWorker = await Tesseract.createWorker("spa", 1, { logger: handleOCRProgress });
    await ocrWorker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300"
    });
}

function handleOCRProgress(message) {
    if (!message) return;
    if (message.status) processingStatus.textContent = translateOCRStatus(message.status);
    if (typeof message.progress === "number") progressFill.style.width = `${Math.round(message.progress * 100)}%`;
}

function translateOCRStatus(status) {
    const map = {
        "loading tesseract core": "Cargando motor OCR...",
        "initializing tesseract": "Inicializando OCR...",
        "loading language traineddata": "Cargando idioma español...",
        "initializing api": "Preparando reconocimiento...",
        "recognizing text": "Reconociendo texto..."
    };
    return map[status] || status;
}

async function processSingleImage(file) {
    const originalDataURL = await fileToDataURL(file);

    processingStatus.textContent = "1/5 · Normalizando y corrigiendo geometría...";
    const processed = await preprocessDocument(originalDataURL);

    processingStatus.textContent = "2/5 · OCR preliminar de la factura...";
    const fullOCR = await recognizeWithMode(processed.dataURL, "6");

    processingStatus.textContent = "3/5 · Segmentando encabezado, productos y pie...";
    const region = detectProductRegion(fullOCR.data, processed.width, processed.height);
    const productImage = await cropDataURL(processed.dataURL, region.x, region.y, region.width, region.height);

    processingStatus.textContent = "4/5 · OCR enfocado en la región de productos...";
    let productOCR;
    try {
        productOCR = await recognizeWithMode(productImage, "6");
    } catch (cropErr) {
        console.warn("No se pudo procesar el OCR de la región recortada, usando OCR completo:", cropErr);
        productOCR = fullOCR;
    }

    processingStatus.textContent = "5/5 · Estructurando productos...";
    const rawOCRText = (productOCR && productOCR.data && productOCR.data.text) || (fullOCR && fullOCR.data && fullOCR.data.text) || "";
    const products = extractProducts(rawOCRText);

    return {
        file,
        originalDataURL,
        processedDataURL: processed.dataURL,
        productRegionDataURL: productImage,
        width: processed.width,
        height: processed.height,
        text: rawOCRText,
        fullText: (fullOCR && fullOCR.data && fullOCR.data.text) || "",
        confidence: (productOCR && productOCR.data && productOCR.data.confidence) || (fullOCR && fullOCR.data && fullOCR.data.confidence) || 0,
        fullConfidence: (fullOCR && fullOCR.data && fullOCR.data.confidence) || 0,
        productConfidence: (productOCR && productOCR.data && productOCR.data.confidence) || 0,
        lines: (productOCR && productOCR.data && productOCR.data.lines) || [],
        segmentation: region,
        products,
        threshold: processed.threshold,
        method: processed.method,
        rotation: processed.rotation
    };
}

async function recognizeWithMode(dataURL, psm) {
    await ocrWorker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    return ocrWorker.recognize(dataURL);
}

// ============================================================
// PREPROCESAMIENTO
// ============================================================
// Escala, corrección de rotación, grises, normalización
// de iluminación, ISODATA, Sauvola y morfología
// ============================================================

async function preprocessDocument(dataURL) {
    const image = await loadImage(dataURL);
    const normalized = resizeImage(image, 1800, 3000);
    const deskewed = autoDeskew(normalized.canvas, normalized.width, normalized.height);
    const canvas = deskewed.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
        gray[p] = clampByte(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }

    // Corrección de iluminación: el fondo local se estima con un blur grande
    const background = boxBlur(gray, width, height, Math.max(15, Math.round(Math.min(width, height) / 70)));
    const normalizedGray = new Uint8Array(gray.length);
    for (let p = 0; p < gray.length; p++) {
        const bg = Math.max(35, background[p]);
        normalizedGray[p] = clampByte((gray[p] / bg) * 220);
    }

    const contrasted = new Uint8Array(gray.length);
    const contrast = 1.16;
    for (let p = 0; p < contrasted.length; p++) {
        contrasted[p] = clampByte(contrast * (normalizedGray[p] - 128) + 128);
    }

    const isodata = isodataThreshold(contrasted);
    const windowSize = chooseOdd(Math.max(21, Math.min(41, Math.round(Math.min(width, height) / 70))));
    const mask = sauvolaMask(contrasted, width, height, windowSize, 0.20, 128);
    const inkRatio = countOnes(mask) / mask.length;
    let finalMask = mask;
    let method = `Sauvola ${windowSize}×${windowSize} + ISODATA(${isodata})`;

    if (inkRatio < 0.002 || inkRatio > 0.38) {
        finalMask = globalMask(contrasted, isodata);
        method = `ISODATA(${isodata}) + morfología`;
    }

    // Reduce ruido y repara pequeños cortes
    finalMask = morphOpen(finalMask, width, height, 1);
    finalMask = morphClose(finalMask, width, height, 1);

    const out = ctx.createImageData(width, height);
    for (let p = 0, i = 0; p < finalMask.length; p++, i += 4) {
        const v = finalMask[p] ? 0 : 255;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);

    return {
        dataURL: canvas.toDataURL("image/png"),
        width,
        height,
        threshold: isodata,
        method,
        rotation: deskewed.angle
    };
}

function resizeImage(image, maxWidth, maxHeight) {
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, width, height };
}

function autoDeskew(sourceCanvas, width, height) {
    const maxDim = 500;
    const scale = Math.min(maxDim / width, maxDim / height, 1);
    const sw = Math.max(40, Math.round(width * scale));
    const sh = Math.max(40, Math.round(height * scale));
    const small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(sourceCanvas, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh).data;
    const gray = new Uint8Array(sw * sh);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    let bestAngle = 0;
    let bestScore = -Infinity;
    for (let angle = -8; angle <= 8; angle += 1) {
        const score = horizontalAlignmentScore(gray, sw, sh, angle * Math.PI / 180);
        if (score > bestScore) {
            bestScore = score;
            bestAngle = angle;
        }
    }

    if (Math.abs(bestAngle) < 1) return { canvas: sourceCanvas, angle: 0 };
    return { canvas: rotateCanvas(sourceCanvas, bestAngle), angle: bestAngle };
}

function horizontalAlignmentScore(gray, width, height, radians) {
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const rows = new Float64Array(height);
    const counts = new Uint32Array(height);
    const step = Math.max(1, Math.floor(Math.max(width, height) / 450));

    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const xx = x - cx, yy = y - cy;
            const xr = Math.round(cos * xx + sin * yy + cx);
            const yr = Math.round(-sin * xx + cos * yy + cy);
            if (xr < 1 || xr >= width - 1 || yr < 1 || yr >= height - 1) continue;
            const p = yr * width + xr;
            const gx = Math.abs(gray[p + 1] - gray[p - 1]);
            const gy = Math.abs(gray[p + width] - gray[p - width]);
            // Texto horizontal genera bordes verticales; premiamos gx.
            rows[yr] += gx;
            counts[yr]++;
        }
    }
    let mean = 0, n = 0;
    for (let i = 0; i < rows.length; i++) if (counts[i]) { const v = rows[i] / counts[i]; mean += v; n++; }
    mean /= Math.max(1, n);
    let variance = 0;
    for (let i = 0; i < rows.length; i++) if (counts[i]) { const v = rows[i] / counts[i]; variance += (v - mean) * (v - mean); }
    return variance / Math.max(1, n);
}

function rotateCanvas(source, angleDegrees) {
    const radians = angleDegrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians));
    const w = source.width, h = source.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * cos + h * sin);
    canvas.height = Math.ceil(w * sin + h * cos);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(radians);
    ctx.drawImage(source, -w / 2, -h / 2);
    return canvas;
}

function chooseOdd(n) {
    const value = Math.max(3, Math.round(n));
    return value % 2 ? value : value + 1;
}

function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function clampIndex(v, length) { return v < 0 ? 0 : v >= length ? length - 1 : v; }

function boxBlur(src, width, height, radius) {
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);
    const size = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[y * width + clampIndex(k, width)];
        for (let x = 0; x < width; x++) {
            tmp[y * width + x] = Math.round(sum / size);
            sum -= src[y * width + clampIndex(x - radius, width)];
            sum += src[y * width + clampIndex(x + radius + 1, width)];
        }
    }
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += tmp[clampIndex(k, height) * width + x];
        for (let y = 0; y < height; y++) {
            out[y * width + x] = Math.round(sum / size);
            sum -= tmp[clampIndex(y - radius, height) * width + x];
            sum += tmp[clampIndex(y + radius + 1, height) * width + x];
        }
    }
    return out;
}

function integralImage(src, width, height) {
    const stride = width + 1;
    const integral = new Float64Array(stride * (height + 1));
    for (let y = 1; y <= height; y++) {
        let rowSum = 0;
        const srcRow = (y - 1) * width;
        const row = y * stride, prev = (y - 1) * stride;
        for (let x = 1; x <= width; x++) {
            rowSum += src[srcRow + x - 1];
            integral[row + x] = integral[prev + x] + rowSum;
        }
    }
    return integral;
}

function windowStats(sumIntegral, sqIntegral, width, x, y, radius) {
    const height = Math.floor(sumIntegral.length / (width + 1)) - 1;
    const stride = width + 1;
    const x1 = Math.max(0, x - radius), y1 = Math.max(0, y - radius);
    const x2 = Math.min(width - 1, x + radius), y2 = Math.min(height - 1, y + radius);
    const a = y1 * stride + x1, b = y1 * stride + x2 + 1;
    const c = (y2 + 1) * stride + x1, d = (y2 + 1) * stride + x2 + 1;
    const area = (x2 - x1 + 1) * (y2 - y1 + 1);
    const sum = sumIntegral[d] - sumIntegral[b] - sumIntegral[c] + sumIntegral[a];
    const sq = sqIntegral[d] - sqIntegral[b] - sqIntegral[c] + sqIntegral[a];
    const mean = sum / area;
    return { mean, std: Math.sqrt(Math.max(0, sq / area - mean * mean)) };
}

function sauvolaMask(src, width, height, windowSize, k, R) {
    const radius = Math.floor(windowSize / 2);
    const sum = integralImage(src, width, height);
    const sqSrc = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) sqSrc[i] = src[i] * src[i];
    const sq = integralImage(sqSrc, width, height);
    const mask = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const { mean, std } = windowStats(sum, sq, width, x, y, radius);
            const threshold = mean * (1 + k * (std / R - 1));
            mask[p] = src[p] < threshold ? 1 : 0;
        }
    }
    return mask;
}

function isodataThreshold(src) {
    let t = 128;
    for (let iter = 0; iter < 25; iter++) {
        let sumLow = 0, countLow = 0, sumHigh = 0, countHigh = 0;
        for (let i = 0; i < src.length; i++) {
            if (src[i] <= t) { sumLow += src[i]; countLow++; }
            else { sumHigh += src[i]; countHigh++; }
        }
        if (!countLow || !countHigh) break;
        const next = Math.round((sumLow / countLow + sumHigh / countHigh) / 2);
        if (Math.abs(next - t) < 1) return next;
        t = next;
    }
    return t;
}

function globalMask(src, threshold) {
    const mask = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) mask[i] = src[i] < threshold ? 1 : 0;
    return mask;
}

function countOnes(mask) {
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    return count;
}

function morphOpen(mask, width, height, radius) { return dilateMask(erodeMask(mask, width, height, radius), width, height, radius); }
function morphClose(mask, width, height, radius) { return erodeMask(dilateMask(mask, width, height, radius), width, height, radius); }

function erodeMask(src, width, height, radius) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let v = 1;
        for (let k = -radius; k <= radius; k++) if (!src[y * width + clampIndex(x + k, width)]) { v = 0; break; }
        tmp[y * width + x] = v;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let v = 1;
        for (let k = -radius; k <= radius; k++) if (!tmp[clampIndex(y + k, height) * width + x]) { v = 0; break; }
        out[y * width + x] = v;
    }
    return out;
}

function dilateMask(src, width, height, radius) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let v = 0;
        for (let k = -radius; k <= radius; k++) if (src[y * width + clampIndex(x + k, width)]) { v = 1; break; }
        tmp[y * width + x] = v;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let v = 0;
        for (let k = -radius; k <= radius; k++) if (tmp[clampIndex(y + k, height) * width + x]) { v = 1; break; }
        out[y * width + x] = v;
    }
    return out;
}

// ============================================================
// SEGMENTACIÓN SEMÁNTICA
// ============================================================

function detectProductRegion(ocrData, width, height) {
    const lines = (ocrData && ocrData.lines) || [];
    const normalized = lines.map((line, index) => ({
        index,
        text: cleanOCRLine(line.text || ""),
        bbox: line.bbox || { x0: 0, y0: 0, x1: width, y1: height },
        confidence: line.confidence || 0
    })).filter(x => x.text);

    const headerIndex = normalized.findIndex(x => isProductTableHeader(x.text));
    const headerBboxY1 = (headerIndex >= 0 && normalized[headerIndex].bbox && Number.isFinite(normalized[headerIndex].bbox.y1))
        ? normalized[headerIndex].bbox.y1
        : null;
    let startY = headerBboxY1 !== null ? headerBboxY1 + 6 : findFirstProductY(normalized, height);

    let endY = height;
    const startIndex = Math.max(0, headerIndex + 1);
    for (let i = startIndex; i < normalized.length; i++) {
        const text = normalized[i].text;
        if (isInvoiceFooter(text)) {
            const footerY0 = normalized[i].bbox && Number.isFinite(normalized[i].bbox.y0)
                ? normalized[i].bbox.y0
                : null;
            if (footerY0 !== null) {
                endY = Math.max(startY + 40, footerY0 - 6);
            }
            break;
        }
    }

    startY = Math.max(0, Math.min(height - 40, Number.isFinite(startY) ? startY : 0));
    endY = Math.max(startY + 40, Math.min(height, Number.isFinite(endY) ? endY : height));

    return {
        x: 0,
        y: Math.round(startY),
        width: Math.round(width),
        height: Math.round(endY - startY),
        headerDetected: headerIndex >= 0,
        footerDetected: endY < height,
        headerText: headerIndex >= 0 ? normalized[headerIndex].text : null,
        note: headerIndex >= 0 ? "Se eliminó la zona situada antes de la cabecera de productos." : "No se detectó cabecera; se utilizó segmentación conservadora."
    };
}

function isProductTableHeader(text) {
    const t = text.toUpperCase();
    const hits = [/#/, /\bUM\b|\bUN\b/, /VR\.?\s*UNIT|UNIT/, /\bCANT\b|CANTIDAD/, /VR\.?\s*TOTAL|TOTAL/];
    return hits.filter(re => re.test(t)).length >= 3;
}

function findFirstProductY(lines, height) {
    for (const line of lines) {
        if (/^\d{3,7}\s+[A-ZÁÉÍÓÚÑ]/i.test(line.text)) {
            const y0 = line.bbox && Number.isFinite(line.bbox.y0) ? line.bbox.y0 : null;
            if (y0 !== null) return Math.max(0, y0 - 8);
        }
    }
    return Math.round(height * 0.18);
}

function isInvoiceFooter(text) {
    return /^(SUBTOTAL|TOTAL\s+A\s+PAGAR|TOTAL|IVA|IMPUESTO|FORMA\s+DE\s+PAGO|MEDIO\s+DE\s+PAGO|EFECTIVO|CAMBIO|TARJETA|VISA|MASTERCARD|GRACIAS|PAGO)/i.test(text);
}

async function cropDataURL(dataURL, x, y, width, height) {
    const image = await loadImage(dataURL);
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;

    const sx = Math.max(0, Math.min(imgW - 1, Math.round(x || 0)));
    const sy = Math.max(0, Math.min(imgH - 1, Math.round(y || 0)));
    const sw = Math.max(1, Math.min(imgW - sx, Math.round(width || imgW)));
    const sh = Math.max(1, Math.min(imgH - sy, Math.round(height || imgH)));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/png");
}

// ============================================================
// EXTRACCIÓN DE TEXTO
// ============================================================

function extractProducts(rawText) {
    const lines = rawText.split(/\r?\n/).map(cleanOCRLine).filter(Boolean);
    const products = [];
    let pending = null;
    let lastProduct = null;
    let waitingFinalPrice = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^PRECIO\s+FINAL(?:\s+[\d.,-]+)?$/i.test(line)) {
            const inline = line.match(/^PRECIO\s+FINAL\s+([\d.,-]+)$/i);
            if (inline && lastProduct) lastProduct.total = moneyToNumber(inline[1]);
            else waitingFinalPrice = true;
            continue;
        }

        if (waitingFinalPrice && lastProduct && /^[\d.,-]+$/.test(line)) {
            lastProduct.total = moneyToNumber(line);
            waitingFinalPrice = false;
            continue;
        }

        if (/^(AHORRO|DESCUENTO|PROMOCI)/i.test(line)) continue;
        if (isNonProductLine(line)) continue;

        const product = parseProductLine(line);
        if (product) {
            pending = product;
            continue;
        }

        const quantity = parseQuantityLine(line);
        if (quantity && pending) {
            pending.cantidad = quantity.cantidad;
            pending.unidad_medida = quantity.unidad;
            pending.precio_unitario = quantity.precio_unitario;
            pending.total = quantity.total;
            const finalized = finalizeProduct(pending);
            products.push(finalized);
            lastProduct = finalized;
            pending = null;
            continue;
        }

        const loose = parseLooseQuantityLine(line);
        if (loose && pending) {
            pending.cantidad = loose.cantidad;
            pending.unidad_medida = loose.unidad;
            pending.precio_unitario = loose.precio_unitario;
            pending.total = loose.total;
            const finalized = finalizeProduct(pending);
            products.push(finalized);
            lastProduct = finalized;
            pending = null;
        }
    }

    return products;
}

function isNonProductLine(line) {
    return /^(T\/P|NIT|GERENTE|TELEF|TEL\.?|FECHA|DIRECCI|CAJA|FACTURA|SUBTOTAL|TOTAL|IVA|CAMBIO|EFECTIVO|TARJETA|VISA|MASTERCARD|FORMA\s+DE\s+PAGO|MEDIO\s+DE\s+PAGO|AHORRO|DESCUENTO|PROMOCI|PRECIO\s+FINAL|\#\s*UM)/i.test(line);
}

function parseProductLine(line) {
    const match = line.match(/^\s*(\d{3,7})\s+(.{2,100}?)\s*\*?\s*$/);
    if (!match) return null;
    const name = normalizeProductName(match[2]);
    if (!name || /^(AHORRO|PRECIO|TOTAL|CANT|UNIT|VR\.?)/i.test(name)) return null;
    return {
        codigo: match[1],
        producto: name,
        cantidad: null,
        unidad_medida: null,
        precio_unitario: null,
        total: null
    };
}

function parseQuantityLine(line) {
    const m = line.match(/^\s*(\d{1,3})\s+(un|ud|und|kg|g|gr|lb|l|lt|ml|cc|paq|pqt|doc|caja|bot|botella)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*\*?$/i);
    if (!m) return null;
    return {
        cantidad: quantityToNumber(m[4]),
        unidad: normalizeUnit(m[2]),
        precio_unitario: moneyToNumber(m[3]),
        total: moneyToNumber(m[5])
    };
}

function parseLooseQuantityLine(line) {
    const m = line.match(/^\s*(\d{1,3})\s+(kg|g|gr|lb|l|lt|ml|cc|un|ud|und)\s+([\d.,]+)\s+([\d.,]+)\s*$/i);
    if (!m) return null;
    return {
        cantidad: quantityToNumber(m[4]),
        unidad: normalizeUnit(m[2]),
        precio_unitario: null,
        total: moneyToNumber(m[3])
    };
}

function finalizeProduct(product) {
    return {
        codigo: product.codigo,
        producto: product.producto,
        cantidad: product.cantidad,
        unidad_medida: product.unidad_medida,
        precio_unitario: product.precio_unitario,
        total: product.total
    };
}

function cleanOCRLine(line) {
    return String(line)
        .replace(/[|]/g, "I")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeProductName(value) {
    return value.replace(/\s{2,}/g, " ").replace(/\s+\*+$/, "").trim();
}

function normalizeUnit(unit) {
    const u = unit.toLowerCase();
    const map = {
        un: "unidad", ud: "unidad", und: "unidad",
        kg: "kg", g: "g", gr: "g", lb: "lb",
        l: "litro", lt: "litro", ml: "ml", cc: "ml",
        paq: "paquete", pqt: "paquete", doc: "docena",
        caja: "caja", bot: "botella", botella: "botella"
    };
    return map[u] || u;
}

function quantityToNumber(value) {
    const v = String(value).replace(/\s/g, "");
    if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
    return Number(v);
}

function moneyToNumber(value) {
    const v = String(value).replace(/\s/g, "").replace(/-$/, "");
    if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
    return Number(v.replace(/\./g, ""));
}

// ============================================================
// INTERFAZ
// ============================================================

function renderResult(result) {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.textContent = result.file.name;

    const meta = document.createElement("div");
    meta.className = "processing-meta";
    meta.innerHTML = `<span>Procesamiento: ${escapeHTML(result.method)}</span><span>Rotación: ${result.rotation.toFixed(1)}°</span><span>OCR productos: ${Math.round(result.productConfidence)}%</span>`;

    const comparison = document.createElement("div");
    comparison.className = "image-comparison image-comparison-three";
    comparison.append(
        createImagePanel("1 · Original", result.originalDataURL),
        createImagePanel("2 · Blanco y negro", result.processedDataURL),
        createImagePanel("3 · Región de productos", result.productRegionDataURL)
    );

    const segmentationInfo = document.createElement("div");
    segmentationInfo.className = "segmentation-info";
    segmentationInfo.textContent = result.segmentation.headerDetected
        ? `Segmentación automática: encabezado detectado (${result.segmentation.headerText}). La región OCR se concentra en los productos.`
        : "Segmentación automática conservadora: no se encontró una cabecera inequívoca; se conserva la mayor parte del documento para evitar pérdida de productos.";

    const ocrHeader = document.createElement("div");
    ocrHeader.className = "ocr-header";
    const ocrTitle = document.createElement("h4");
    ocrTitle.textContent = "OCR editable · solo región de productos";
    const confidence = document.createElement("span");
    confidence.className = "confidence";
    confidence.textContent = `Confianza: ${Math.round(result.productConfidence)}%`;
    ocrHeader.append(ocrTitle, confidence);

    const textArea = document.createElement("textarea");
    textArea.className = "ocr-text";
    textArea.value = result.text || "";
    textArea.placeholder = "El texto reconocido aparecerá aquí. Puedes corregirlo antes de guardar.";
    textArea.setAttribute("aria-label", "Texto OCR editable");

    const actionRow = document.createElement("div");
    actionRow.className = "result-actions";

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "btn btn-secondary";
    previewButton.textContent = "Actualizar productos";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn btn-primary";
    saveButton.textContent = "Confirmar y guardar JSON";

    const extraction = document.createElement("div");
    extraction.className = "extraction-preview hidden";

    const updatePreview = () => {
        const parsed = extractProducts(textArea.value);
        renderExtractionPreview(extraction, parsed);
        extraction.classList.remove("hidden");
        return parsed;
    };

    previewButton.addEventListener("click", updatePreview);
    saveButton.addEventListener("click", () => {
        const parsed = updatePreview();
        if (!parsed.length) {
            alert("No se encontraron productos con el formato esperado. Corrige el OCR y vuelve a intentarlo.");
            return;
        }
        const json = buildProductJSON(result, parsed);
        downloadJSON(json, buildJSONFileName(result.file.name));
        extraction.classList.add("saved-state");
    });

    actionRow.append(previewButton, saveButton);
    card.append(title, meta, comparison, segmentationInfo, ocrHeader, textArea, actionRow, extraction);
    resultsContainer.appendChild(card);

    updatePreview();
}

function createImagePanel(title, dataURL) {
    const panel = document.createElement("div");
    panel.className = "image-panel";
    const heading = document.createElement("h4");
    heading.textContent = title;
    const image = document.createElement("img");
    image.src = dataURL;
    image.alt = title;
    panel.append(heading, image);
    return panel;
}

function renderExtractionPreview(container, products) {
    container.innerHTML = "";
    const heading = document.createElement("h4");
    heading.textContent = `Lista estructurada · ${products.length} producto(s)`;
    container.appendChild(heading);

    if (!products.length) {
        const empty = document.createElement("p");
        empty.className = "empty-products";
        empty.textContent = "No se pudo estructurar un producto todavía. Revisa y corrige el OCR.";
        container.appendChild(empty);
        return;
    }

    const table = document.createElement("table");
    table.className = "product-table";
    table.innerHTML = `<thead><tr><th>Código</th><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Precio unit.</th><th>Total</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const p of products) {
        const tr = document.createElement("tr");
        [p.codigo, p.producto, p.cantidad, p.unidad_medida, formatNumber(p.precio_unitario), formatNumber(p.total)].forEach(value => {
            const td = document.createElement("td");
            td.textContent = value ?? "";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    const note = document.createElement("p");
    note.className = "json-note";
    note.textContent = "El JSON contiene únicamente productos y sus datos de compra; no incluye encabezado, tienda, fecha ni datos administrativos.";
    container.appendChild(note);
}

function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "";
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(value);
}

function buildProductJSON(result, products) {
    return {
        schema: "sabor.productos.factura",
        version: "1.0",
        origen: "OCR_local",
        fuente_archivo: result.file.name,
        productos: products.map(p => ({
            codigo: p.codigo || null,
            producto: p.producto || null,
            cantidad: p.cantidad ?? null,
            unidad_medida: p.unidad_medida || null,
            precio_unitario: p.precio_unitario ?? null,
            total: p.total ?? null
        }))
    };
}

function buildJSONFileName(originalName) {
    const base = originalName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_");
    return `${base}_productos.json`;
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

function renderError(file, error) {
    const card = document.createElement("article");
    card.className = "result-card";
    const title = document.createElement("h3");
    title.textContent = file.name;
    const message = document.createElement("div");
    message.className = "result-error";
    message.textContent = `No se pudo procesar esta imagen: ${error.message || error}`;
    card.append(title, message);
    resultsContainer.appendChild(card);
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("No se pudo cargar la imagen."));
        image.src = dataURL;
    });
}

async function terminateOCRWorker() {
    if (!ocrWorker) return;
    try { await ocrWorker.terminate(); }
    catch (error) { console.warn("No se pudo cerrar el worker OCR:", error); }
    ocrWorker = null;
}
