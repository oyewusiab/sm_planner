import html2pdf from "html2pdf.js";

export async function generatePDF(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element with id "${elementId}" not found for PDF generation.`);
    alert("Could not generate PDF: Preview area not found.");
    return;
  }

  try {
    const opt = {
      margin: 0.25,
      filename: `${filename}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
    };

    if (elementId === "assignments-print-area") {
      opt.jsPDF.orientation = "portrait";
    } else {
      opt.jsPDF.orientation = "landscape";
    }

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = "wait";

    await html2pdf().set(opt).from(element).save();

    document.body.style.cursor = originalCursor;
  } catch (error) {
    console.error("PDF generation error:", error);
    alert("An error occurred while generating the PDF. Please try printing instead.");
  }
}
