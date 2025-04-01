// Importar pdfjsLib OTRA VEZ como módulo
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.3.136/build/pdf.mjs';

// Configurar workerSrc usando pdfjsLib importado
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.3.136/build/pdf.worker.mjs';
console.log("PDF.js workerSrc configurado vía import.");

// --- Referencias a Elementos del DOM ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const statusDiv = document.getElementById('status');
const imageContainer = document.getElementById('image-container');
const downloadAllBtn = document.getElementById('downloadAllBtn');

// --- Variable Global para guardar imágenes procesadas ---
let processedImages = [];

// --- Funciones de Utilidad ---
function updateStatus(message, type = 'info') {
    statusDiv.innerHTML = `<div class="alert alert-${type}" role="alert">${message}</div>`;
}

function clearResults() {
    imageContainer.innerHTML = '';
    statusDiv.innerHTML = '';
    processedImages = [];
    downloadAllBtn.disabled = true;
}

// --- Manejadores de Eventos (Input, Drag/Drop) ---
dropZone.addEventListener('click', () => { fileInput.click(); });
fileInput.addEventListener('change', (event) => {
    const files = event.target.files;
    if (files.length > 0) { handleFile(files[0]); }
    fileInput.value = '';
});
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); dropZone.classList.add('hover'); });
dropZone.addEventListener('dragleave', (event) => { event.preventDefault(); event.stopPropagation(); dropZone.classList.remove('hover'); });
dropZone.addEventListener('drop', (event) => {
    event.preventDefault(); event.stopPropagation(); dropZone.classList.remove('hover');
    const files = event.dataTransfer.files;
    if (files.length > 0) { handleFile(files[0]); }
});

// --- Manejador para el botón Descargar Todas ---
downloadAllBtn.addEventListener('click', downloadAllImagesAsZip);

// --- Lógica Principal de Procesamiento del PDF ---
async function handleFile(file) {
    clearResults();
    if (file.type !== 'application/pdf') {
        updateStatus('Error: El archivo seleccionado no es un PDF.', 'danger');
        return;
    }
    updateStatus('Leyendo archivo PDF...', 'info');
    const reader = new FileReader();

    reader.onload = async (event) => {
        const arrayBuffer = event.target.result;
        updateStatus('Procesando PDF... Esto puede tardar.', 'info');
        try {
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            updateStatus(`PDF cargado. Analizando ${pdf.numPages} página(s)...`, 'info');

            let currentImageIndex = 0;
            const imagePromises = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const operatorList = await page.getOperatorList();
                const { OPS } = pdfjsLib;

                for (let j = 0; j < operatorList.fnArray.length; j++) {
                    if (operatorList.fnArray[j] === OPS.paintImageXObject) {
                        const imageName = operatorList.argsArray[j][0];
                        try {
                            const imgData = page.objs.get(imageName);
                            if (imgData) {
                                currentImageIndex++;
                                imagePromises.push(
                                    processImageData(imgData, currentImageIndex)
                                        .catch(imgError => {
                                            console.warn(`Error procesando datos img ${currentImageIndex} (ref: ${imageName}):`, imgError);
                                            return null;
                                        })
                                );
                            }
                        } catch (getObjError) { console.error(`Error en page.objs.get('${imageName}')':`, getObjError); }
                    }
                }
                if (page.cleanup) page.cleanup();
            }

            processedImages = (await Promise.all(imagePromises)).filter(img => img !== null);

            // === PUNTO CLAVE ===
            // Si hay imágenes, las muestra Y habilita el botón
            if (processedImages.length > 0) {
                updateStatus(`Extracción completada. Se encontraron ${processedImages.length} imágenes.`, 'success');
                // 1. Muestra las imágenes en la página
                displayImages(processedImages);
                // 2. Habilita el botón de descarga
                downloadAllBtn.disabled = false;
            } else {
                updateStatus('No se encontraron imágenes válidas en este archivo PDF.', 'warning');
                downloadAllBtn.disabled = true;
            }

        } catch (error) {
            console.error("[handleFile] Error GENERAL procesando PDF:", error);
            let errorMessage = 'Error al procesar el archivo PDF.';
            if (error && error.name === 'PasswordException') { errorMessage = 'Error: PDF protegido con contraseña.'; }
            else if (error && error.name === 'InvalidPDFException') { errorMessage = 'Error: PDF inválido o corrupto.'; }
            else if (error instanceof Error) { errorMessage += ` (${error.message})`; }
            updateStatus(errorMessage, 'danger');
            downloadAllBtn.disabled = true;
        }
    };

    reader.onerror = () => {
        console.error("[handleFile] Error en FileReader.");
        updateStatus('Error al leer el archivo.', 'danger');
        downloadAllBtn.disabled = true;
    };
    reader.readAsArrayBuffer(file);
}


// --- Procesamiento de Imágenes (processImageData) ---
async function processImageData(imgData, index) {
    if (imgData && imgData.bitmap instanceof ImageBitmap) { // Prioridad 1: Bitmap
        try {
            const canvas = document.createElement('canvas'); canvas.width = imgData.width; canvas.height = imgData.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(imgData.bitmap, 0, 0);
            let mimeType = 'image/png'; let fileExtension = 'png';
            if (imgData.kind === 1) { mimeType = 'image/jpeg'; fileExtension = 'jpg'; }
            const dataUrl = canvas.toDataURL(mimeType);
            imgData.bitmap.close();
            return { url: dataUrl, name: `imagen_${index}.${fileExtension}` };
        } catch (canvasError) { console.error(`[processImageData] Imagen ${index}: Error Canvas:`, canvasError); return null; }
    }
    else if (imgData && imgData.data && imgData.data.length > 0) { // Prioridad 2: Data
        try {
            let mimeType = 'image/jpeg'; let fileExtension = 'jpg';
            const dataBytes = new Uint8Array(imgData.data.slice(0, 4));
             if (dataBytes[0] === 0x89 && dataBytes[1] === 0x50) { mimeType = 'image/png'; fileExtension = 'png'; }
             /* ... otros tipos ... */
            const blob = new Blob([imgData.data], { type: mimeType });
            if (blob.size === 0) return null;
            const objectURL = URL.createObjectURL(blob);
            return { url: objectURL, name: `imagen_${index}.${fileExtension}` };
        } catch (blobError) { console.error(`[processImageData] Imagen ${index}: Error Fallback Blob:`, blobError); return null; }
    } else { return null; }
}

// --- Visualización de Imágenes (displayImages) ---
function displayImages(images) {
    imageContainer.innerHTML = '';
    images.forEach((imgInfo, i) => {
        if (!imgInfo || !imgInfo.url) return;
        const colDiv = document.createElement('div'); colDiv.className = 'col-lg-3 col-md-4 col-sm-6 col-12 mb-3';
        const cardDiv = document.createElement('div'); cardDiv.className = 'card h-100 shadow-sm';
        const imgElement = document.createElement('img'); imgElement.src = imgInfo.url; imgElement.alt = `Imagen extraída ${i + 1}`; imgElement.className = 'card-img-top img-thumbnail p-2'; imgElement.style.maxHeight = '200px'; imgElement.style.objectFit = 'contain';
        imgElement.onerror = () => { console.error(`Error al cargar <img> para imagen ${i+1}`); cardDiv.innerHTML = `<div class="card-body text-center text-danger small p-2">Error al<br>cargar img ${i+1}</div>`; };
        const cardBody = document.createElement('div'); cardBody.className = 'card-body text-center p-2 d-flex flex-column';
        const downloadLink = document.createElement('a'); downloadLink.href = imgInfo.url; downloadLink.download = imgInfo.name; downloadLink.className = 'btn btn-sm btn-primary mt-auto'; downloadLink.textContent = 'Descargar'; downloadLink.setAttribute('role', 'button');
        cardBody.appendChild(downloadLink); cardDiv.appendChild(imgElement); cardDiv.appendChild(cardBody); colDiv.appendChild(cardDiv);
        imageContainer.appendChild(colDiv);
    });
}


// --- Descargar Todas como ZIP (usar JSZip y saveAs globales) ---
async function downloadAllImagesAsZip() {
    if (!processedImages || processedImages.length === 0) { alert("No hay imágenes extraídas para descargar."); return; }
    if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') { alert("Error: Faltan librerías para generar el archivo ZIP."); return; }

    updateStatus("Generando archivo ZIP...", "info");
    downloadAllBtn.disabled = true;
    const zip = new JSZip();

    try {
        for (const imgInfo of processedImages) {
            try {
                let imageData; const filename = imgInfo.name || `imagen_${processedImages.indexOf(imgInfo) + 1}.png`;
                if (imgInfo.url.startsWith('data:')) { const base64Data = imgInfo.url.split(',')[1]; zip.file(filename, base64Data, { base64: true }); }
                else if (imgInfo.url.startsWith('blob:')) { const response = await fetch(imgInfo.url); if (!response.ok) throw new Error(`Fetch failed ${response.status}`); const blobData = await response.blob(); zip.file(filename, blobData); }
                else { continue; }
            } catch (fetchOrProcessError) { console.error(`Error procesando imagen ${imgInfo.name || 'desconocida'} para ZIP:`, fetchOrProcessError); continue; }
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        saveAs(zipBlob, "imagenes_extraidas.zip");
        updateStatus(`¡Archivo ZIP generado con ${processedImages.length} imágenes!`, "success");
    } catch (zipError) { console.error("[Download All] Error generando ZIP:", zipError); updateStatus("Error al generar el archivo ZIP.", "danger"); }
    finally { downloadAllBtn.disabled = false; }
}

// --- Inicialización ---
console.log("Extractor de Imágenes PDF inicializado (script como módulo).");