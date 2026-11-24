import { NextResponse } from "next/server";
import {
  customPageResponse,
  pageResponse,
  rejectUnlessWebsite,
} from "@/lib/siteContent";
import { isWebsitePage } from "@/lib/websiteSections";

/**
 * GET /api/site/pages/[slug] (website only: x-cms-secret). Website cache tag "page:<slug>".
 *
 * Fixed pages (home, about, services, products, portfolio, contactUs, blog, media):
 *   { success, data: { [sectionType]: content }, seo } with only the sections in use
 *   (PAGE_SECTIONS in src/lib/websiteSections.ts), blog post bodies left out.
 *
 * Pages made in Custom Pages:
 *   { success, custom: true, sections: [{ id, type, content, order }], seo }, every section
 *   in page order, so a section type can be used more than once.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const denied = rejectUnlessWebsite(request);
  if (denied) return denied;

  const { slug } = await params;
  const notFound = () =>
    NextResponse.json(
      { success: false, error: "Page not found" },
      { status: 404 },
    );

  try {
    if (!isWebsitePage(slug)) {
      const custom = await customPageResponse(slug);
      return custom ? NextResponse.json(custom) : notFound();
    }

    const page = await pageResponse(slug, { blogBodies: false });
    if (!page.seo) return notFound();
    return NextResponse.json(page);
  } catch (error) {
    console.error(`[site] page ${slug}:`, error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
