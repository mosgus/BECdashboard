import { redirect } from "next/navigation";

// Root portfolio page — immediately redirects to the Holdings tab.
// The layout.tsx wrapping this route renders the persistent header and tab nav.
export default async function PortfolioRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/portfolios/${id}/holdings`);
}
