import { ArrowRight, Download, Share, X } from 'lucide-react'
import { Button } from './components/ui/button'
import type { PwaInstallController } from './usePwaInstall'
import './PwaInstallPrompt.css'

export function PwaInstallCard({ controller }: { controller: PwaInstallController }) {
  if (!controller.mode) return null
  const nativeInstall = controller.mode === 'native'
  const copy = nativeInstall
    ? 'Add Saathi to your home screen and open it in its own window.'
    : 'Tap the Share button, choose Add to Home Screen, then tap Add.'
  const content = <>
    <span className="pwa-install-icon">{nativeInstall ? <Download size={28} /> : <Share size={28} />}</span>
    <span><strong>{nativeInstall ? 'Install Saathi on this device' : 'Add Saathi to your Home Screen'}</strong><small>{copy}</small></span>
    {nativeInstall && <ArrowRight size={24} />}
  </>
  return nativeInstall
    ? <Button className="pwa-install-card" onClick={() => void controller.install()}>{content}</Button>
    : <div className="pwa-install-card pwa-install-card-manual" role="note">{content}</div>
}

export function PwaInstallReminder({ controller }: { controller: PwaInstallController }) {
  if (!controller.mode) return null
  const nativeInstall = controller.mode === 'native'
  return <aside className="pwa-install-reminder" aria-label="Install Saathi">
    <span className="pwa-install-reminder-icon">{nativeInstall ? <Download size={21} /> : <Share size={21} />}</span>
    <div>
      <strong>Keep Saathi one tap away</strong>
      <small>{nativeInstall
        ? 'Add Saathi to your home screen and open it in its own window.'
        : 'Tap Share, choose Add to Home Screen, then tap Add.'}</small>
      <span className="pwa-install-reminder-actions">
        {nativeInstall && <Button onClick={() => void controller.install()}>Install Saathi</Button>}
        <Button variant="ghost" onClick={controller.dismiss}>Not now</Button>
      </span>
    </div>
    <Button variant="ghost" size="icon" className="pwa-install-reminder-close" onClick={controller.dismiss} aria-label="Dismiss install reminder"><X size={18} /></Button>
  </aside>
}
