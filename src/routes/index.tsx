import { createFileRoute } from "@tanstack/react-router";
import { AuraApp } from "@/components/aura/AuraApp";

export const Route = createFileRoute("/")({
  component: AuraApp,
});
