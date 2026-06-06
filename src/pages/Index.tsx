import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderOpen, LayoutGrid, Palette } from "lucide-react";
import Hero from "@/components/factory/Hero";
import ContentTypeGrid from "@/components/factory/ContentTypeGrid";
import { ContentFactoryGallery } from "@/components/factory/ContentFactoryGallery";
import { BrandTemplatePanel } from "@/components/factory/BrandTemplatePanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clearWizardState } from "@/lib/contentFactoryBrief";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { getCreateRoute } from "@/data/contentTypeFlows";

const Index = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "create";

  const handleSelect = (id: string) => {
    setSelectedId(id);
    clearWizardState();
    const type = CONTENT_TYPES.find((t) => t.id === id);
    const route = getCreateRoute(type);
    window.setTimeout(() => {
      navigate(route, { state: { typeId: id } });
    }, 200);
  };

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "create") next.delete("tab");
    else next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="pb-10">
      <Hero />

      <div className="container mt-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6 grid h-auto w-full grid-cols-3 gap-1 rounded-2xl bg-secondary/50 p-1">
            <TabsTrigger value="create" className="gap-2 rounded-xl py-2.5 text-xs sm:text-sm">
              <LayoutGrid className="h-4 w-4" />
              Создать
            </TabsTrigger>
            <TabsTrigger value="gallery" className="gap-2 rounded-xl py-2.5 text-xs sm:text-sm">
              <FolderOpen className="h-4 w-4" />
              Готовый контент
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2 rounded-xl py-2.5 text-xs sm:text-sm">
              <Palette className="h-4 w-4" />
              Шаблоны бренда
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-0">
            <ContentTypeGrid selectedId={selectedId} onSelect={handleSelect} />
          </TabsContent>

          <TabsContent value="gallery" className="mt-0">
            <ContentFactoryGallery active={tab === "gallery"} />
          </TabsContent>

          <TabsContent value="templates" className="mt-0">
            <BrandTemplatePanel />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default Index;
