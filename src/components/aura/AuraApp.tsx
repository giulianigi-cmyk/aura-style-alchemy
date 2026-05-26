import { useEffect, useState } from "react";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
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

export type Screen =
  | "splash" | "onboarding" | "home" | "wardrobe" | "add"
  | "ai" | "planner" | "shop" | "community" | "profile";

export function AuraApp() {
  const [screen, setScreen] = useState<Screen>("splash");

  useEffect(() => {
    if (screen === "splash") {
      const t = setTimeout(() => setScreen("onboarding"), 2200);
      return () => clearTimeout(t);
    }
  }, [screen]);

  const showTabs = !["splash", "onboarding", "add"].includes(screen);

  return (
    <PhoneFrame>
      <div className="relative h-full w-full overflow-hidden bg-background">
        <div key={screen} className="absolute inset-0 animate-fade-in">
          {screen === "splash" && <Splash />}
          {screen === "onboarding" && <Onboarding onDone={() => setScreen("home")} />}
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
