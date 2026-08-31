import { useCallback, useEffect, useState } from "react";
import { Splash } from "./screens/Splash";
import { Onboarding } from "./screens/Onboarding";
import { Auth } from "./screens/Auth";
import { ResetPassword } from "./screens/ResetPassword";
import { ProfileSetup } from "./screens/ProfileSetup";
import { Home } from "./screens/Home";
import { Wardrobe } from "./screens/Wardrobe";
import { AddItem } from "./screens/AddItem";
import { AIStylist } from "./screens/AIStylist";
import { StylistChat } from "./screens/StylistChat";
import { OutfitScan } from "./screens/OutfitScan";
import { BatchScan } from "./screens/BatchScan";
import { BatchReview } from "./screens/BatchReview";
import { Trips } from "./screens/Trips";
import { TripCreate } from "./screens/TripCreate";
import { TripDetail } from "./screens/TripDetail";
import { EssentialPresets } from "./screens/EssentialPresets";
import { Planner } from "./screens/Planner";
import { Shop } from "./screens/Shop";
import { ColorLab } from "./screens/ColorLab";
import { Community } from "./screens/Community";
import { Profile } from "./screens/Profile";
import { Insights } from "./screens/Insights";
import { Settings } from "./screens/Settings";
import { PersonalInfo } from "./screens/PersonalInfo";
import { StylePreferences } from "./screens/StylePreferences";
import { SettingsSizes } from "./screens/SettingsSizes";
import { SettingsLanguage } from "./screens/SettingsLanguage";
import { SettingsWardrobeLocations } from "./screens/SettingsWardrobeLocations";
import { SettingsDressPreferences } from "./screens/SettingsDressPreferences";
import { NotificationSettings } from "./screens/NotificationSettings";
import { SettingsCalendar } from "./screens/SettingsCalendar";
import { PrivacySettings } from "./screens/PrivacySettings";
import { Notifications } from "./screens/Notifications";
import { Invite } from "./screens/Invite";
import { StorageDebug } from "./screens/StorageDebug";
import { Chats } from "./screens/Chats";
import { ChatThread } from "./screens/ChatThread";
import { OutfitBuilder } from "./screens/OutfitBuilder";
import { PersonalColorAnalysis } from "./screens/PersonalColorAnalysis";
import { UserProfile } from "./screens/UserProfile";

import { TabBar } from "./TabBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { PhoneFrame } from "./PhoneFrame";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useChatNotifications } from "@/hooks/use-chat-notifications";

export type Screen =
    | "splash" | "onboarding" | "auth" | "reset" | "profile-setup"
    | "home" | "wardrobe" | "add" | "ai" | "planner" | "shop" | "community" | "profile"
      | "insights" | "saved-outfits" | "notifications" | "invite" | "builder" | "color-lab" | "color-analysis" | "stylist-chat" | "outfit-scan" | "batch-scan" | "batch-review" | "storage-debug"
      | "trips" | "trip-create" | "trip-detail" | "essential-presets"
            | "chats" | "chat-thread" | "user-profile"
      | "settings" | "settings-personal" | "settings-sizes" | "settings-style-prefs" | "settings-language"
      | "settings-wardrobe-locations" | "settings-dress-preferences" | "settings-notifications" | "settings-calendar" | "settings-privacy";





export type BuilderInit = {
  itemIds: string[];
  name?: string;
  occasion?: string;
  notes?: string;
  outfitId?: string;
} | null;

export type StylistChatInit = {
  message: string;
  temperature: number | null;
  condition: string | null;
  date?: string | null;
  eventId?: string | null;
} | null;


function Inner() {
  const { user, loading, recovery } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const [screen, setScreen] = useState<Screen>("splash");
  const [builderInit, setBuilderInit] = useState<BuilderInit>(null);
  const [stylistChatInit, setStylistChatInit] = useState<StylistChatInit>(null);
  const [reviewScanId, setReviewScanId] = useState<string | null>(null);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [userProfileBack, setUserProfileBack] = useState<Screen>("community");
  const [wardrobeGapFilter, setWardrobeGapFilter] = useState<"price" | "purchase_date" | null>(null);
  const [plannerFocus, setPlannerFocus] = useState<{ date: string; planId: string | null } | null>(null);
  const [tripFocusActivityId, setTripFocusActivityId] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("aura.onboarded") === "1"
  );

  const go = (s: Screen) => {
    if (s !== "builder") setBuilderInit(null);
    else if (s === "builder") {
      setBuilderInit(null);
    }
    if (s !== "stylist-chat") setStylistChatInit(null);
    setScreen(s);
  };

  const openBatchReview = (scanId: string) => {
    setReviewScanId(scanId);
    setScreen("batch-review");
  };

  const openBuilder = (init: BuilderInit) => {
    setBuilderInit(init);
    setScreen("builder");
  };

  const openStylistChat = (init: NonNullable<StylistChatInit>) => {
    setStylistChatInit(init);
    setScreen("stylist-chat");
  };

  const openConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setScreen("chat-thread");
  }, []);

  const openUserProfile = useCallback((id: string) => {
    setActiveUserId(id);
    setUserProfileBack((prev) => (screen === "user-profile" ? prev : screen));
    setScreen("user-profile");
  }, [screen]);

  // Weather-change proposals deep-link into whichever surface owns the
  // plan: the Planner day sheet, or the trip activity that plan dresses.
  const openPlanner = useCallback((date: string, planId?: string | null) => {
    setPlannerFocus({ date, planId: planId ?? null });
    setScreen("planner");
  }, []);

  const openTripActivity = useCallback((tripId: string, activityId: string) => {
    setActiveTripId(tripId);
    setTripFocusActivityId(activityId);
    setScreen("trip-detail");
  }, []);


  useChatNotifications(openConversation);

  useEffect(() => {
    if (recovery) setScreen("reset");
  }, [recovery]);

  // Backfill thumbnails for outfits saved before the thumbnail pipeline
  // existed. Idle, best-effort, once per session — the picker keeps
  // falling back to the original image for anything not yet processed.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      void import("@/lib/outfit-thumb").then((m) => m.backfillOutfitThumbs(user.id));
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user]);

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

  useEffect(() => {
    if (loading || screen === "splash" || screen === "reset") return;
    if (!user && !["onboarding", "auth"].includes(screen)) {
      setScreen("auth");
      return;
    }
    if (user && ["auth"].includes(screen)) {
      if (typeof window !== "undefined") {
        try {
          const addBack = window.localStorage.getItem("aura:add_friend_return");
          if (addBack && addBack.startsWith("/add/")) {
            window.localStorage.removeItem("aura:add_friend_return");
            window.location.replace(addBack);
            return;
          }
        } catch { /* ignore */ }
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

  const showTabs = user && !["splash", "onboarding", "auth", "reset", "profile-setup", "add", "builder", "stylist-chat", "chat-thread"].includes(screen);

  return (
    <PhoneFrame>
      <div className="relative h-full w-full overflow-hidden bg-background">
                <div key={screen} className="absolute inset-0 animate-fade-in">
          <ErrorBoundary onReset={() => go("home")}>
          {screen === "splash" && <Splash go={go} />}
          {screen === "onboarding" && <Onboarding onDone={finishOnboarding} />}
          {screen === "auth" && <Auth />}
          {screen === "reset" && <ResetPassword onDone={() => setScreen(user ? "home" : "auth")} />}
          {screen === "profile-setup" && <ProfileSetup onDone={() => setScreen("home")} />}
          {screen === "home" && <Home go={go} />}
                    {screen === "wardrobe" && <Wardrobe go={go} gapFilter={wardrobeGapFilter} onClearGapFilter={() => setWardrobeGapFilter(null)} />}

          {screen === "add" && <AddItem onClose={() => go("wardrobe")} />}
          {screen === "ai" && <AIStylist go={go} openBuilder={openBuilder} />}
          {screen === "stylist-chat" && <StylistChat go={go} openBuilder={openBuilder} initialMessage={stylistChatInit} />}
          {screen === "outfit-scan" && <OutfitScan go={go} />}
          {screen === "batch-scan" && <BatchScan go={go} openReview={openBatchReview} />}
                    {screen === "batch-review" && reviewScanId && <BatchReview go={go} scanId={reviewScanId} />}
          {screen === "trips" && <Trips go={go} openTrip={(id) => { setActiveTripId(id); setTripFocusActivityId(null); setScreen("trip-detail"); }} />}
          {screen === "trip-create" && <TripCreate go={go} onCreated={(id) => { setActiveTripId(id); setScreen("trip-detail"); }} />}
          {screen === "trip-detail" && activeTripId && <TripDetail go={go} tripId={activeTripId} focusActivityId={tripFocusActivityId} />}
          {screen === "essential-presets" && <EssentialPresets go={go} />}
          {screen === "planner" && <Planner go={go} openStylistChat={openStylistChat} focus={plannerFocus} />}
          {screen === "shop" && <Shop go={go} />}
          {screen === "color-lab" && <ColorLab go={go} />}
          {screen === "community" && <Community go={go} openConversation={openConversation} openUserProfile={openUserProfile} />}
                    {screen === "profile" && <Profile go={go} openConversation={openConversation} openUserProfile={openUserProfile} />}
          {screen === "settings" && <Settings go={go} />}
          {screen === "settings-personal" && <PersonalInfo go={go} />}
          {screen === "settings-style-prefs" && <StylePreferences go={go} />}
          {screen === "settings-sizes" && <SettingsSizes go={go} />}
          {screen === "settings-language" && <SettingsLanguage go={go} />}
          {screen === "settings-wardrobe-locations" && <SettingsWardrobeLocations go={go} />}
          {screen === "settings-dress-preferences" && <SettingsDressPreferences go={go} />}
          {screen === "settings-notifications" && <NotificationSettings go={go} />}
          {screen === "settings-calendar" && <SettingsCalendar go={go} />}
          {screen === "settings-privacy" && <PrivacySettings go={go} />}

                    {screen === "insights" && <Insights go={go} openWardrobeGap={(f) => { setWardrobeGapFilter(f); go("wardrobe"); }} />}

                        {screen === "saved-outfits" && <AIStylist go={go} openBuilder={openBuilder} />}
          {screen === "notifications" && (
            <Notifications go={go} openThread={openConversation} openPlanner={openPlanner} openTripActivity={openTripActivity} />
          )}
          {screen === "invite" && <Invite go={go} />}
          {screen === "storage-debug" && <StorageDebug go={go} />}
          {screen === "chats" && <Chats go={go} openThread={openConversation} />}
          {screen === "chat-thread" && activeConversationId && (
            <ChatThread go={go} conversationId={activeConversationId} onBack={() => setScreen("chats")} />
          )}
          {screen === "builder" && <OutfitBuilder go={go} init={builderInit} />}
          {screen === "color-analysis" && <PersonalColorAnalysis go={go} />}
          {screen === "user-profile" && (
            activeUserId
              ? <UserProfile userId={activeUserId} go={go} onBack={() => setScreen(userProfileBack)} />
              : <div className="h-full flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  This profile is not available.
                </div>
          )}
          </ErrorBoundary>
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
