export async function extractTextFromPDF(file: File): Promise<string> {
  // Dynamically load PDF.js if not available
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load PDF.js library from CDN."));
      document.head.appendChild(script);
    });
  }

  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const typedarray = new Uint8Array(buffer);
        const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
        
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          // Join the text items of the page, separating by newlines
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join("\n");
          fullText += pageText + "\n";
        }
        resolve(fullText);
      } catch (err) {
        console.error("Error reading or parsing PDF:", err);
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
