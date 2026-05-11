/**
 * Render every element with class `.report-page` inside `root` to a multipage PDF.
 * Each section is captured as a hi-res screenshot in its original colors.
 */
export async function exportReportPdf(
  root: HTMLElement,
  filename = "report.pdf",
) {
  const pages = Array.from(root.querySelectorAll<HTMLElement>(".report-page"));
  if (pages.length === 0) throw new Error("Нет страниц для экспорта");

  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    const el = pages[i];
    // ensure the element is visible (in case wrapper hides on small screens)
    const canvas = await html2canvas(el, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: el.scrollWidth,
    });
    const imgData = canvas.toDataURL("image/png");
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    if (i > 0) pdf.addPage("a4", "landscape");
    pdf.addImage(imgData, "PNG", x, y, w, h);
  }

  pdf.save(filename);
}
