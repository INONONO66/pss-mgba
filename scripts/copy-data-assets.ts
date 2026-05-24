import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const assetPairs = [
  {
    from: path.join("src", "pokemon", "data"),
    to: path.join("dist", "src", "pokemon", "data"),
  },
] as const;

for (const pair of assetPairs) {
  await mkdir(pair.to, { recursive: true });
  const entries = await readdir(pair.from, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) =>
        copyFile(
          path.join(pair.from, entry.name),
          path.join(pair.to, entry.name)
        )
      )
  );
}
