# Scene reference

A scene is a JSON object:

```json
{
  "shot": "s5",
  "say": "text for the panel",
  "keep": false,
  "items": [ { "type": "arrow", "to": [412, 230] } ]
}
```

- `shot` (optional): image id the coordinates refer to. Defaults to the image `wait` named. An item's own `shot` wins.
- `say` (optional): text shown in the panel together with the drawing.
- `keep` (optional): `true` adds the items to what is already drawn instead of replacing it.
- `items`: list of guides. A bare JSON array is also accepted as the item list.

Points are `[x, y]`, rects are `[x, y, w, h]`, all in pixels of the shot. `show` prints warnings for unknown types, missing fields and coordinates outside the image; fix and resend if you get any.

## Items

Common optional fields: `label` (text bubble placed next to the guide), `color` (CSS color, default pink `#ff3d7f`), `delay` (ms before it appears), `ttl` (ms until it fades out), `shot`.

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

### html

```json
{ "type": "html", "rect": [500, 300, 320, 180], "html": "<div>...</div><style>...</style><script>...</script>" }
```

or `"file": "C:/absolute/path/anim.html"` instead of `"html"`.

- Runs in a sandboxed, transparent iframe placed at `rect` (whole screen if omitted). It cannot be clicked, has no network access, and is limited to 512 KB. Inline everything.
- A global `TMA` object is predefined:
  - `TMA.pt(x, y)` maps shot pixels to iframe CSS pixels, returning `[x, y]`.
  - `TMA.rect(x, y, w, h)` does the same for a rect.
  - `TMA.width`, `TMA.height` give the iframe size; `TMA.color` is the item color.
- Prefer animations that loop or settle into a final state, because the user may look over at any moment.

Example: show that a layer above covers the one below.

```json
{
  "type": "html",
  "rect": [620, 260, 260, 170],
  "html": "<style>.l{position:absolute;left:40px;width:150px;height:90px;border-radius:10px;box-shadow:0 6px 18px #0006;font:600 14px 'Segoe UI','Microsoft YaHei UI';color:#fff;display:grid;place-items:center}.a{top:60px;background:#3b82f6}.b{top:10px;background:#ff3d7f;animation:s 2.6s ease-in-out infinite}@keyframes s{0%,20%{transform:translate(70px,-10px)}50%,100%{transform:translate(20px,30px)}}</style><div class='l a'>下面的图层</div><div class='l b'>上面的图层</div>"
}
```

## Patterns

A step sequence on one screen, appearing one after another:

```json
{
  "say": "三步：选中 → 右键 → 选「合并」。",
  "items": [
    { "type": "step", "at": [120, 210], "n": 1, "label": "选中" },
    { "type": "click", "at": [120, 210], "button": "right", "delay": 600 },
    { "type": "step", "at": [210, 330], "n": 2, "delay": 1200, "label": "点「合并」" }
  ]
}
```

A precise target in dense UI: run `zoom --rect` on the area, read the coordinates from the zoomed image, then

```json
{ "shot": "s7", "items": [ { "type": "box", "rect": [88, 40, 30, 22], "label": "这个小图标" } ] }
```
