import { route, staffRoles } from "@/lib/api";
import { withDatabaseAccess } from "@/lib/auth";
import { normalizeArabic, scoreText, searchTerms } from "@/lib/text";

export const GET = route(staffRoles, async (user, request) => {
  const terms = searchTerms(request.nextUrl.searchParams.get("q") ?? "");
  if (!terms.length) return { results: [] };
  return withDatabaseAccess(user, async (tx) => {
    const cases = await tx.legalCase.findMany({
      where: { deletedAt: null },
      select: { id: true, caseNumber: true, title: true, client: { select: { name: true } } },
      take: 500,
    });
    // Client-side ranking below folds spelling across all visible records.
    const clients = await tx.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true, phone: true }, take: 1000 });
    const documents = await tx.documentPage.findMany({
      where: { document: { deletedAt: null }, OR: terms.map((term) => ({ searchText: { contains: term } })) },
      select: { page: true, searchText: true, document: { select: { id: true, title: true } } },
      take: 100,
    });
    const rank = <T,>(rows: T[], text: (row: T) => string) =>
      rows.map((row) => ({ row, score: scoreText(text(row), terms) })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ row }) => row);
    return {
      results: [
        ...rank(cases, (row) => normalizeArabic(`${row.caseNumber} ${row.title} ${row.client.name}`)).map((row) => ({ id: row.id, kind: "قضية", title: `${row.caseNumber} — ${row.title}`, detail: row.client.name, href: `/app/cases/${row.id}` })),
        ...rank(clients, (row) => normalizeArabic(`${row.name} ${row.phone}`)).map((row) => ({ id: row.id, kind: "عميل", title: row.name, detail: row.phone, href: `/app/clients?q=${encodeURIComponent(row.name)}` })),
        ...rank(documents, (row) => row.searchText).map((row) => ({ id: `${row.document.id}-${row.page}`, kind: "مستند", title: row.document.title, detail: `ص ${row.page}`, href: `/app/documents?view=${row.document.id}&page=${row.page}` })),
      ],
    };
  });
});
