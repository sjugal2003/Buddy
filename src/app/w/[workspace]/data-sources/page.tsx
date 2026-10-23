import { DataSourcesView } from "@/components/views/data-sources-view";
import { listDataSourceCatalog } from "@/lib/data";

export default async function DataSourcesPage() {
  const catalog = await listDataSourceCatalog();
  return <DataSourcesView catalog={catalog} />;
}
