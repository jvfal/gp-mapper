import { toBlob } from "html-to-image";
import { getNodesBounds } from "@xyflow/react";

export async function captureMap(container, flow) {
  const viewport = container?.querySelector(".react-flow__viewport");
  const nodes = flow.getNodes();
  if (!viewport || !nodes.length) throw new Error("Empty map");

  await Promise.all(
    [...viewport.querySelectorAll("img")].map((image) => image.decode()),
  );
  const bounds = getNodesBounds(nodes);
  let left = bounds.x,
    top = bounds.y;
  let right = bounds.x + bounds.width,
    bottom = bounds.y + bounds.height;
  function include(rect) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  // Same-side connections can curve beyond the nodes' bounding rectangle.
  for (const path of viewport.querySelectorAll(".react-flow__edge-path"))
    include(path.getBBox());
  const origin = viewport.getBoundingClientRect();
  const zoom = flow.getViewport().zoom;
  for (const label of viewport.querySelectorAll(".edge-time")) {
    const rect = label.getBoundingClientRect();
    include({
      x: (rect.left - origin.left) / zoom,
      y: (rect.top - origin.top) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    });
  }
  const padding = 80;
  const width = Math.max(320, Math.ceil(right - left + padding * 2));
  const height = Math.max(240, Math.ceil(bottom - top + padding * 2));
  // Keep the full graph, reducing pixel density rather than cropping large maps.
  const pixelRatio = Math.min(
    2,
    8192 / width,
    8192 / height,
    Math.sqrt(16_000_000 / (width * height)),
  );
  const blob = await toBlob(viewport, {
    width,
    height,
    pixelRatio,
    backgroundColor: "#15191b",
    skipFonts: true,
    filter: (element) =>
      !element.classList?.contains("react-flow__handle") &&
      !element.classList?.contains("react-flow__edge-interaction") &&
      !element.classList?.contains("react-flow__nodesselection"),
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${padding - left}px, ${padding - top}px) scale(1)`,
      transformOrigin: "0 0",
    },
  });
  if (!blob) throw new Error("Image capture failed");
  return blob;
}
