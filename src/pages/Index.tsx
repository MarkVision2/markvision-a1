import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/factory/Header";
import Hero from "@/components/factory/Hero";
import ContentTypeGrid from "@/components/factory/ContentTypeGrid";
import LiveCounter from "@/components/factory/LiveCounter";

const Index = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSelect = (id: string) => {
    setSelectedId(id);
    // короткая задержка для подсветки selected-состояния, затем переход
    window.setTimeout(() => {
      navigate("/create/step-1", { state: { typeId: id } });
    }, 250);
  };

  const handleClose = () => {
    setSelectedId(null);
    navigate("/");
  };

  return (
    <main className="min-h-screen">
      <Header onClose={handleClose} />
      <Hero />
      <ContentTypeGrid selectedId={selectedId} onSelect={handleSelect} />
      <LiveCounter />
    </main>
  );
};

export default Index;
