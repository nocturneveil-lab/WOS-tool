# Alliance Map

`default-layout.json` is loaded every time the page opens. Map layouts are not kept in the browser, so every visitor sees the published layout after a reload. Keep it in the same published directory as `index.html`.

To update the published default, edit the map, export it with the page's **ファイルに保存** button, and replace `default-layout.json` with that JSON file. The JSON also carries the object colors, map size, bear trap label size, and the initial view (center and zoom). The zoom stored in `default-layout.json` is shown as 100%.

Exported JSON and SVG filenames include the local save date and time to the minute (`YYYY-MM-DD_HH-mm`).
