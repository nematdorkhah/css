import FileViewerModal from './FileViewerModal'

interface AttachmentViewerModalProps {
  url: string
  title?: string
  onClose: () => void
}

export default function AttachmentViewerModal({
  url,
  title = 'فایل پیوست',
  onClose,
}: AttachmentViewerModalProps) {
  return <FileViewerModal url={url} fileName={title} onClose={onClose} />
}
