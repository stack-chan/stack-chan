import { Pencil, X } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type ProjectAsset, type VisualProject } from '@/features/project-editor/project-types'

export function ProjectAssetsPanel({
  project,
  faceAssets,
  onSelectFace,
  onEmbedAssetsChange,
  onRemoveAsset,
  onEditFace,
}: {
  project: VisualProject
  faceAssets: ProjectAsset[]
  onSelectFace: (path: string | null) => void
  onEmbedAssetsChange: (checked: boolean) => void
  onRemoveAsset: (path: string) => void
  onEditFace: () => void
}) {
  const { t } = useI18n()
  const selectedFace = project.settings.faceAsset ?? 'default'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('アセット')}</CardTitle>
        <CardDescription>{t('画像やカスタムFaceをMODへ追加します。')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="project-face-select">Face</Label>
          <div className="flex gap-2">
            <Select value={selectedFace} onValueChange={(value) => onSelectFace(value === 'default' ? null : value)}>
              <SelectTrigger id="project-face-select" className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('標準Face')}</SelectItem>
                {faceAssets.map((asset) => (
                  <SelectItem key={asset.path} value={asset.path}>
                    {asset.path.replace(/^assets\//, '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={onEditFace}
              disabled={selectedFace === 'default'}
              aria-label={t('使用中のFaceを編集')}
            >
              <Pencil />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="embed-project-assets"
            checked={project.settings.embedAssets}
            onCheckedChange={(checked) => onEmbedAssetsChange(checked === true)}
          />
          <Label htmlFor="embed-project-assets">{t('アセットをMODへ埋め込む')}</Label>
        </div>
        <div className="flex flex-wrap gap-2" aria-label={t('追加済みアセット')}>
          {project.assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('アセットなし')}</p>
          ) : (
            project.assets.map((asset) => (
              <Badge key={asset.path} variant="secondary" className="gap-1 pr-1">
                <span className="max-w-44 truncate">{asset.path.replace(/^assets\//, '')}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemoveAsset(asset.path)}
                  aria-label={t('{path}を削除', { path: asset.path })}
                >
                  <X />
                </Button>
              </Badge>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
