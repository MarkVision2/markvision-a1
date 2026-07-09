// @ffmpeg-installer/ffmpeg не поставляет типов — минимальное объявление
// только того, что реально используем (путь к бинарнику).
declare module "@ffmpeg-installer/ffmpeg" {
  const ffmpeg: { path: string; version: string; url: string };
  export default ffmpeg;
}
