import { NextResponse } from "next/server";
import { listRepos } from "@/lib/repo-service";
import { getRepoFavicon } from "@/lib/repo-favicon";

export const dynamic = "force-dynamic";

// req-050: das Favicon des Repos von `main`. 404, wenn es keins (oder kein
// lesbares) gibt — der Chat zeigt dann den Platzhalter.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repo = (await listRepos()).find((r) => r.id === id);
  if (!repo) return new NextResponse(null, { status: 404 });
  const icon = await getRepoFavicon(repo.url);
  if (!icon) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.contentType,
      "Cache-Control": "private, max-age=3600",
      // SVG darf als Bild laden, aber keine Skripte der fremden Datei ausführen.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
