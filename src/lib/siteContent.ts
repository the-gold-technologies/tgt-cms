import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withoutBlogBodies } from "@/lib/blogPosts";
import { toHeadingTag, type HeadingTag } from "@/lib/headingTags";
import { isWebsiteRequest } from "@/lib/revalidateWebsite";
import { isWebsitePage, PAGE_SECTIONS } from "@/lib/websiteSections";

/**
 * Page responses, shared by the admin page APIs (/api/home, /api/about, …) and the website's
 * /api/site/pages/[slug]: { success, data: { [type]: content }, seo } with only the page's
 * editable sections (PAGE_SECTIONS) and the page's SEO (edited in SEO → Page Settings).
 */

/** 401 unless the request comes from the website's server with the shared secret. */
export const rejectUnlessWebsite = (request: Request) =>
  isWebsiteRequest(request)
    ? null
    : NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

export interface PageSEO {
  title: string;
  slug: string;
  metaTitle: string | null;
  metaDescription: string | null;
  targetKeywords: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  featuredImage: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  schema: string | null;
  headingOptions: HeadingTag | ""; // main heading tag, "" = website default
}

const SEO_SELECT = {
  title: true,
  slug: true,
  metaTitle: true,
  metaDescription: true,
  targetKeywords: true,
  canonicalUrl: true,
  noIndex: true,
  featuredImage: true,
  ogTitle: true,
  ogDescription: true,
  ogImage: true,
  schema: true,
  headingOptions: true,
} as const;

/**
 * A page's SEO, or null if the page doesn't exist yet.
 * The home page's SEO is edited in SEO → Global Settings (GlobalConfig), not Page Settings.
 * Service pages also have their own, per service, in each section's content.seo.
 */
export async function loadPageSeo(slug: string): Promise<PageSEO | null> {
  const page = await prisma.page.findUnique({
    where: { slug },
    select: SEO_SELECT,
  });
  if (!page) return null;
  const seo: PageSEO = {
    ...page,
    headingOptions: toHeadingTag(page.headingOptions),
  };
  if (slug !== "home") return seo;

  const global = await prisma.globalConfig.findUnique({
    where: { id: "global" },
    select: {
      siteTitle: true,
      siteDescription: true,
      schema: true,
      headingOptions: true,
    },
  });
  return {
    ...seo,
    metaTitle: global?.siteTitle || seo.metaTitle,
    metaDescription: global?.siteDescription || seo.metaDescription,
    schema: global?.schema || seo.schema,
    headingOptions: toHeadingTag(global?.headingOptions ?? null) || seo.headingOptions,
  };
}

/**
 * The page's editable sections as { [type]: content }, in page order.
 * blogBodies: false (the website) leaves out blog post bodies; editors need them.
 */
export async function loadPageSections(
  slug: string,
  { blogBodies }: { blogBodies: boolean },
): Promise<Record<string, unknown>> {
  const allowed = PAGE_SECTIONS[slug];
  if (!allowed) return {};
  const rows = await prisma.section.findMany({
    where: {
      page: { slug },
      ...(allowed === "all" ? {} : { type: { in: [...allowed] } }),
    },
    orderBy: { order: "asc" },
    select: { type: true, content: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.type, (blogBodies ? row : withoutBlogBodies(row)).content]),
  );
}

/** { success, data, seo } for a page with the section map as data. */
export async function pageResponse(slug: string, { blogBodies }: { blogBodies: boolean }) {
  const [data, seo] = await Promise.all([
    loadPageSections(slug, { blogBodies }),
    loadPageSeo(slug),
  ]);
  return { success: true as const, data, seo };
}

/** A section of a custom page, in page order (a type can appear more than once). */
export interface CustomPageSection {
  id: string;
  type: string;
  content: unknown;
  order: number;
}

/**
 * { success, custom: true, sections, seo } for a page made in Custom Pages (type "standard",
 * not one of the fixed website pages), or null if there is no such page.
 * Pages stay "draft" when created and there is no publish switch yet, so every custom page is served.
 */
export async function customPageResponse(slug: string) {
  if (isWebsitePage(slug)) return null;
  const page = await prisma.page.findFirst({
    where: { slug, type: "standard" },
    select: { id: true },
  });
  if (!page) return null;

  const [rows, seo] = await Promise.all([
    prisma.section.findMany({
      where: { pageId: page.id },
      orderBy: { order: "asc" },
      select: { id: true, type: true, content: true, order: true },
    }),
    loadPageSeo(slug),
  ]);
  const sections: CustomPageSection[] = rows.map((row) => withoutBlogBodies(row));
  return { success: true as const, custom: true as const, sections, seo };
}
