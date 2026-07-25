import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });

for (const file of ["manifest.json", "options.html", "options.css"]) {
  await cp(`src/${file}`, `dist/${file}`);
}
