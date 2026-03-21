export async function generatePDF(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element with id "${elementId}" not found for PDF generation.`);
    alert("Could not generate PDF: Preview area not found.");
    return;
  }

  try {
    // Dynamically load html2pdf.js if it's not already available
    if (!(window as any).html2pdf) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.crossOrigin = "anonymous";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load html2pdf.js"));
        document.head.appendChild(script);
      });
    }

    // Temporarily adjust styles for better PDF output if needed
    const opt = {
      margin: 0.25,
      filename: `${filename}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
    };

    // If it's the assignments page, we want a portrait orientation
    if (elementId === "assignments-print-area") {
      opt.jsPDF.orientation = "portrait";
    } else {
      // Planner pages usually print better in landscape
      opt.jsPDF.orientation = "landscape";
    }

    // Show a loading indicator natively or rely on the UI
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = "wait";

    await (window as any).html2pdf().set(opt).from(element).save();

    document.body.style.cursor = originalCursor;
  } catch (error) {
    console.error("PDF generation error:", error);
    alert("An error occurred while generating the PDF. Please try printing instead.");
  }
}
