import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Hero from "@/components/factory/Hero";
import ContentTypeGrid from "@/components/factory/ContentTypeGrid";

const Index = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSelect = (id: string) => {
    setSelectedId(id);
    window.setTimeout(() => {
      navigate("/create/step-1", { state: { typeId: id } });
    }, 200);
  };

  return (
    <main className="pb-10">
      <Hero />
      <ContentTypeGrid selectedId={selectedId} onSelect={handleSelect} />
    </main>
  );
};

export default Index;
