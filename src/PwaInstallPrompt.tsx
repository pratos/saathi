import { ArrowRight, Download, X } from 'lucide-react'
import { Button } from './components/ui/button'
import type { PwaInstallController } from './usePwaInstall'
import './PwaInstallPrompt.css'

export function PwaInstallCard({ controller }: { controller: PwaInstallController }) {
  if (!controller.mode) return null
  const copy = controller.mode === 'native'
    ? 'Add Saathi to your home screen and open it in its own window.'
    : 'On iPhone or iPad, tap Share, then choose Add to Home Screen.'
  const content = <>
    <span className="pwa-install-icon"><Download size={28} /></span>
    <span><strong>Install Saathi on this device</strong><small>{copy}</small></span>
    {controller.mode === 'native' && <ArrowRight size={24} />}
  </>
  return controller.mode === 'native'
    ? <Button className="pwa-install-card" onClick={() => void controller.install()}>{content}</Button>
    : <div className="pwa-install-card pwa-install-card-manual" role="note">{content}</div>
}

export function PwaInstallReminder({ controller }: { controller: PwaInstallController }) {
  if (!controller.mode) return null
  return <aside className="pwa-install-reminder" aria-label="Install Saathi">
    <span className="pwa-install-reminder-icon"><Download size={21} /></span>
    <div>
      <strong>Keep Saathi one tap away</strong>
      <small>{controller.mode === 'native'
        ? 'Add Saathi to your home screen and open it in its own window.'
        : 'Tap Share, then Add to Home Screen.'}</small>
      <span className="pwa-install-reminder-actions">
        {controller.mode === 'native' && <Button onClick={() => void controller.install()}>Install Saathi</Button>}
        <Button variant="ghost" onClick={controller.dismiss}>Not now</Button>
      </span>
    </div>
    <Button variant="ghost" size="icon" className="pwa-install-reminder-close" onClick={controller.dismiss} aria-label="Dismiss install reminder"><X size={18} /></Button>
  </aside>
}
