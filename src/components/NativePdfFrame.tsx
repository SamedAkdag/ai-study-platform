type Props = {
  src: string
  className?: string
  title?: string
}

/**
 * Tarayıcının kendi PDF görüntüleyicisi — pdf.js yok.
 * Blob/http URL ile Chrome/Edge’de anında açılır.
 */
export default function NativePdfFrame({
  src,
  className = '',
  title = 'PDF',
}: Props) {
  return (
    <div className={`pdf-viewer pdf-viewer--native ${className}`}>
      <iframe
        title={title}
        src={src}
        className="pdf-viewer__native-frame"
      />
    </div>
  )
}
