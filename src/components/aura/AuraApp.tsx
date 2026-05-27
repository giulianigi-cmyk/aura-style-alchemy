import { useEffect, useState } from "react";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { Auth } from "./screens/Auth";
import { Home } from "./screens/Home";
import { Wardrobe } from "./screens/Wardrobe";
import { AddItem } from "./screens/AddItem";
import { AIStylist } from "./screens/AIStylist";
import { Planner } from "./screens/Planner";
import { Shop } from "./screens/Shop";
import { Community } from "./screens/Community";
import { Profile } from "./screens/Profile";
import { TabBar } from "./TabBar";
import { PhoneFrame } from "./PhoneFrame";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

export type Screen =
  | "splash" | "onboarding" | "auth" | "home" | "wardrobe" | "add"
  | "ai" | "planner" | "shop" | "community" | "profile";

function Inner() {
  const { user, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>("splash");
  const [onboarded, setOnboarded] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("aura.onboarded") === "1"
  );

  useEffect(() => {
    if (loading) return;
    if (screen !== "splash") return;
    const t = setTimeout(() => {
      if (!onboarded) setScreen("onboarding");
      else if (!user) setScreen("auth");
      else setScreen("home");
    }, 1600);
    return () => clearTimeout(t);
  }, [loading, screen, onboarded, user]);

  useEffect(() => {
    if (loading || screen === "splash") return;
    if (!user && !["onboarding", "auth"].includes(screen)) setScreen("auth");
    if (user && ["auth", "onboarding"].includes(screen)) setScreen("home");
  }, [user, loading, screen]);

  const finishOnboarding = () => {
    localStorage.setItem("aura.onboarded", "1");
    setOnboarded(true);
    setScreen(user ? "home" : "auth");
  };

  const showTabs = user && !["splash", "onboarding", "auth", "add"].includes(screen);

  return (
    <PhoneFrame>
      <div className="relative h-full w-full overflow-hidden bg-background">
        <div key={screen} className="absolute inset-0 animate-fade-in">
          {screen === "splash" && <Splash />}
          {screen === "onboarding" && <Onboarding onDone={finishOnboarding} />}
          {screen === "auth" && <Auth />}
          {screen === "home" && <Home go={setScreen} />}
          {screen === "wardrobe" && <Wardrobe go={setScreen} />}
          {screen === "add" && <AddItem onClose={() => setScreen("wardrobe")} />}
          {screen === "ai" && <AIStylist go={setScreen} />}
          {screen === "planner" && <Planner go={setScreen} />}
          {screen === "shop" && <Shop go={setScreen} />}
          {screen === "community" && <Community go={setScreen} />}
          {screen === "profile" && <Profile go={setScreen} />}
        </div>
        {showTabs && <TabBar current={screen} go={setScreen} />}
      </div>
    </PhoneFrame>
  );
}

export function AuraApp() {
  return (
    <AuthProvider>
      <Inner />
    </AuthProvider>
  );
}
