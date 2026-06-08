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
import { cn } from "@/lib/utils";

const TAB_ITEMS = [
  { value: "create", icon: LayoutGrid, label: "Создать", short: "Создать" },
  { value: "gallery", icon: FolderOpen, label: "Готовый контент", short: "Готовое" },
  { value: "templates", icon: Palette, label: "Шаблоны бренда", short: "Бренд" },
] as const;

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
    <main className="pb-6 sm:pb-10">
      <Hero />

      <div className="container px-3 sm:px-4 mt-4 sm:mt-6">
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          {/* Sticky tab bar — удобно переключать одним большим пальцем */}
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-30 -mx-3 bg-background/90 px-3 py-2 backdrop-blur-xl sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-2xl border border-border/40 bg-secondary/60 p-1 shadow-sm">
              {TAB_ITEMS.map(({ value, icon: Icon, label, short }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className={cn(
                    "flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2",
                    "text-[11px] font-semibold leading-tight sm:flex-row sm:gap-2 sm:py-2.5 sm:text-sm",
                    "data-[state=active]:bg-background data-[state=active]:shadow-sm",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0 sm:h-4 sm:w-4" aria-hidden />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="create" className="mt-4 sm:mt-6 focus-visible:outline-none">
            <ContentTypeGrid selectedId={selectedId} onSelect={handleSelect} />
          </TabsContent>

          <TabsContent value="gallery" className="mt-4 sm:mt-6 focus-visible:outline-none">
            <ContentFactoryGallery active={tab === "gallery"} />
          </TabsContent>

          <TabsContent value="templates" className="mt-4 sm:mt-6 focus-visible:outline-none">
            <BrandTemplatePanel />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default Index;
