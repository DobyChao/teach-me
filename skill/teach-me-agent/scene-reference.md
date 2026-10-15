# Scene reference

A scene is a JSON object. `show` replaces the current scene and requires a short `say`.

```json
{
  "shot": "s5",
  "say": "点这里。",
  "pattern": "point",
  "to": [412, 230],
  "label": "文件",
  "items": []
}
```

- `say` (required): short text shown in the capsule with the drawing. This is the only text the capsule shows from you.
- `shot` (optional): image id the coordinates refer to. Defaults to the image `wait` named. An item's own `shot` wins.
- `pattern` (optional): expands into basic items. Unknown patterns warn and add nothing.
- `keep` is ignored. One scene is on screen at a time.
- `items`: extra basic guides. A bare JSON array is also accepted as the item list.

Points are `[x, y]`, rects are `[x, y, w, h]`, all in pixels of the shot. `show` prints warnings for unknown types, missing fields, and coordinates outside the image; fix and resend if you get any.

If the screen's scale or position changed since that shot, `show` still says the text and does not draw. Capture again and use the new image.

## Patterns

| pattern | needs | becomes |
|---------|--------|---------|
| `point` | `to` | one `arrow` |
| `highlight` | `rect` | one `box` |
| `click` | `at` | one `click` (`button` optional) |
| `drag` | `from`, `to` | one `drag` |
| `keys` | `keys` | one `keys` |
| `steps` | `steps` | one `step` per entry, staggered |

```json
{
  "say": "三步：选中，右键，再点合并。",
  "pattern": "steps",
  "steps": [
    { "at": [120, 210], "label": "选中" },
    { "at": [210, 330], "label": "合并" }
  ]
}
```

## Items

Common optional fields: `label`, `color` (CSS color, default pink `#ff3d7f`), `delay` (ms), `ttl` (ms), `shot`.

### arrow

```json
{ "type": "arrow", "to": [412, 230], "from": [600, 360], "label": "点这里" }
```

Draws in, then keeps poking at `to`. Omit `from` to let it come from the screen-center side. `gap` (px, default 6) is how far the tip stops short of `to`.

### box

```json
{ "type": "box", "rect": [380, 210, 120, 36], "label": "这一组都是对齐选项" }
```

### spotlight

```json
{ "type": "spotlight", "rect": [380, 210, 120, 36], "label": "只看这里" }
```

Dims the rest of the screen. Use one at a time.

### click

```json
{ "type": "click", "at": [412, 230], "button": "double", "label": "双击图层名改名" }
```

`button`: `left` (default), `right`, `double`, `middle`.

### drag

```json
{ "type": "drag", "from": [300, 400], "to": [520, 400], "label": "把滑块拖到 50%" }
```

### path

```json
{ "type": "path", "points": [[100, 100], [180, 160], [260, 120]], "label": "沿着边缘画" }
```

### step

```json
{ "type": "step", "at": [412, 230], "n": 1, "label": "先选中" }
```

### label

```json
{ "type": "label", "at": [40, 40], "text": "这一栏是属性面板" }
```

### keys

```json
{ "type": "keys", "keys": ["Ctrl", "Shift", "S"], "label": "另存为" }
```

`at` is optional (default bottom center). `"keys": "Ctrl+Shift+S"` also works.

### scroll

```json
{ "type": "scroll", "at": [600, 400], "direction": "down", "label": "往下滚到底" }
```

### stroke

```json
{ "type": "stroke", "points": [[80, 80], [160, 120], [240, 90]] }
```

Draws on the agent layer of the board (separate from the user's ink). `clear` removes it; `clear --all` also clears user ink.

### html

Text only. A `file` field is rejected.

```json
{
  "type": "html",
  "rect": [620, 260, 260, 170],
  "html": "<style>.l{position:absolute;left:40px;width:150px;height:90px;border-radius:10px;box-shadow:0 6px 18px #0006;font:600 14px 'Segoe UI','Microsoft YaHei UI';color:#fff;display:grid;place-items:center}.a{top:60px;background:#3b82f6}.b{top:10px;background:#ff3d7f;animation:s 2.6s ease-in-out infinite}@keyframes s{0%,20%{transform:translate(70px,-10px)}50%,100%{transform:translate(20px,30px)}}</style><div class='l a'>下面的图层</div><div class='l b'>上面的图层</div>"
}
```

Limits the host enforces:

- `rect` is required. It is clamped so the scene cannot cover the screen (48 px margin, at most 40% of the display area).
- One HTML item per scene. Extra HTML items are dropped.
- At most 256 KB. Inline CSS and JS only.
- Rendered in a `srcdoc` iframe with `sandbox="allow-scripts"` and never `allow-same-origin`.
- CSP is `default-src 'none'`; images, media, and fonts may be `data:` or `blob:`; scripts and styles are inline only.
- The window is click-through, does not take focus, and does not receive keyboard input.
- The host draws a fixed watermark and border. Opacity cannot go below 0.85.
- TTL defaults to 60 s and cannot be longer. A crashed HTML guide is not restored.
- `TMA.pt(x, y)` maps shot pixels to iframe CSS pixels and returns `[x, y]`. `TMA.rect(x, y, w, h)` does the same for a rect. `TMA.width`, `TMA.height`, and `TMA.color` describe the frame.

Prefer a loop or a settled final frame, because the user may look over at any moment.

## Zoom

A precise target in dense UI: run `zoom --rect` on the area, read the coordinates from the zoomed image, then

```json
{ "say": "就是这个小图标。", "shot": "s7", "items": [ { "type": "box", "rect": [88, 40, 30, 22], "label": "这个小图标" } ] }
```
