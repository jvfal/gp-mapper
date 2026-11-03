import fs from "node:fs";

const locales = new URL("../src/locales/", import.meta.url);
const languages = ["pt-BR", "en-US", "es"];
function flatten(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null
      ? flatten(value, path)
      : [[path, value]];
  });
}
for (const namespace of ["common", "mapper"]) {
  let reference;
  for (const language of languages) {
    const entries = flatten(
      JSON.parse(
        fs.readFileSync(
          new URL(`${language}/${namespace}.json`, locales),
          "utf8",
        ),
      ),
    );
    const signature = entries
      .map(([key, value]) => {
        if (typeof value !== "string" || !value.trim())
          throw new Error(`${language}/${namespace}: empty translation ${key}`);
        const variables = [...value.matchAll(/{{\s*(\w+)\s*}}/g)]
          .map((match) => match[1])
          .sort();
        return `${key}:${variables.join(",")}`;
      })
      .sort()
      .join("\n");
    reference ??= signature;
    if (signature !== reference)
      throw new Error(
        `${language}/${namespace}: keys or interpolation variables differ`,
      );
  }
}
console.log(
  "Translations: keys and variables match across all three languages.",
);
