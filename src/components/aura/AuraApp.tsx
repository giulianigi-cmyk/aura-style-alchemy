import { useEffect, useState } from "react";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { Auth } from "./screens/Auth";
import { ResetPassword } from "./screens/ResetPassword";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Home } from "./screens/Home";
import { Wardrobe } from "./screens/Wardrobe";
import { AddItem } from "./screens/AddItem";
import { AIStylist } from "./screens/AIStylist";
import { Planner } from "./screens/Planner";
import { Shop } from "./screens/Shop";
import { ColorLab } from "./screens/ColorLab";
import { Community } from "./screens/Community";
import { Profile } from "./screens/Profile";
import { Insights } from "./screens/Insights";
import { SavedOutfits } from "./screens/SavedOutfits";
import { Notifications } from "./screens/Notifications";
import { Invite } from "./screens/Invite";
import { OutfitBuilder } from "./screens/OutfitBuilder";
import { PersonalColorAnalysis } from "./screens/PersonalColorAnalysis";
import { TabBar } from "./TabBar";
import { PhoneFrame } from "./PhoneFrame";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";

export type Screen =
  | "splash" | "onboarding" | "auth" | "reset" | "profile-setup" | "home" | "wardrobe" | "add"
  | "ai" | "planner" | "shop" | "community" | "profile"
  | "insights" | "saved-outfits" | "notifications" | "invite" | "builder" | "color-lab" | "color-analysis";


export type BuilderInit = {
  itemIds: string[];
  name?: string;
  occasion?: string;
  notes?: string;
  outfitId?: string;
} | null;

function Inner() {
  const { user, loading, recovery } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const [screen, setScreen] = useState<Screen>("splash");
  const [builderInit, setBuilderInit] = useState<BuilderInit>(null);
  const [onboarded, setOnboarded] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("aura.onboarded") === "1"
  );

  // go() wrapper that resets builderInit unless the caller explicitly opens the
  // builder with a preloaded outfit via openBuilder().
  const go = (s: Screen) => {
    if (s !== "builder") setBuilderInit(null);
    else if (s === "builder") {
      // navigating to builder from tab bar / planner → clean canvas
      setBuilderInit(null);
    }
    setScreen(s);
  };

  const openBuilder = (init: BuilderInit) => {
    setBuilderInit(init);
    setScreen("builder");
  };

  // Recovery flow always wins
  useEffect(() => {
    if (recovery) setScreen("reset");
  }, [recovery]);

  // Initial routing after splash
  useEffect(() => {
    if (loading) return;
    if (screen !== "splash") return;
    if (recovery) { setScreen("reset"); return; }
    const t = setTimeout(() => {
      if (!onboarded) setScreen("onboarding");
      else if (!user) setScreen("auth");
      else if (!profileLoading && profile && !profile.setup_complete) setScreen("profile-setup");
      else setScreen("home");
    }, 1600);
    return () => clearTimeout(t);
  }, [loading, profileLoading, screen, onboarded, user, profile, recovery]);

  // Auth state transitions
  useEffect(() => {
    if (loading || screen === "splash" || screen === "reset") return;
    if (!user && !["onboarding", "auth"].includes(screen)) {
      setScreen("auth");
      return;
    }
    if (user && ["auth"].includes(screen)) {
      // If the user was sent to sign in from an MCP consent URL, return them now.
      if (typeof window !== "undefined") {
        try {
          const back = window.localStorage.getItem("aura:mcp_consent_return");
          if (back && back.startsWith("/.lovable/oauth/consent")) {
            window.localStorage.removeItem("aura:mcp_consent_return");
            window.location.replace(back);
            return;
          }
        } catch { /* ignore */ }
      }
      if (!profileLoading && profile && !profile.setup_complete) setScreen("profile-setup");
      else if (!profileLoading) setScreen("home");
    }
    if (user && screen === "onboarding") {
      if (!profileLoading && profile && !profile.setup_complete) setScreen("profile-setup");
    }
  }, [user, loading, screen, profile, profileLoading]);

  const finishOnboarding = () => {
    localStorage.setItem("aura.onboarded", "1");
    setOnboarded(true);
    if (!user) setScreen("auth");
    else if (profile && !profile.setup_complete) setScreen("profile-setup");
    else setScreen("home");
  };

  const showTabs = user && !["splash", "onboarding", "auth", "reset", "profile-setup", "add", "builder"].includes(screen);

  return (
    <PhoneFrame>
      <div className="relative h-full w-full overflow-hidden bg-background">
        <div key={screen} className="absolute inset-0 animate-fade-in">
          {screen === "splash" && <Splash />}
          {screen === "onboarding" && <Onboarding onDone={finishOnboarding} />}
          {screen === "auth" && <Auth />}
          {screen === "reset" && <ResetPassword onDone={() => setScreen(user ? "home" : "auth")} />}
          {screen === "profile-setup" && <ProfileSetup onDone={() => setScreen("home")} />}
          {screen === "home" && <Home go={go} />}
          {screen === "wardrobe" && <Wardrobe go={go} />}
          {screen === "add" && <AddItem onClose={() => go("wardrobe")} />}
          {screen === "ai" && <AIStylist go={go} />}
          {screen === "planner" && <Planner go={go} />}
          {screen === "shop" && <Shop go={go} />}
          {screen === "color-lab" && <ColorLab go={go} />}
          {screen === "community" && <Community go={go} />}
          {screen === "profile" && <Profile go={go} />}
          {screen === "insights" && <Insights go={go} />}
          {screen === "saved-outfits" && <SavedOutfits go={go} openBuilder={openBuilder} />}
          {screen === "notifications" && <Notifications go={go} />}
          {screen === "invite" && <Invite go={go} />}
          {screen === "builder" && <OutfitBuilder go={go} init={builderInit} />}
          {screen === "color-analysis" && <PersonalColorAnalysis go={go} />}
        </div>
        {showTabs && <TabBar current={screen} go={go} />}
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
