
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy,useEffect } from "react";
import { Route, Switch } from "wouter";

import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedRoute from "./components/auth/ProtectedRoute";

import { AuthProvider } from "./contexts/AuthContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminBookingsWorkspace from "./components/admin/AdminBookingsWorkspace";

// Public pages
const Home = lazy(() => import("./pages/Home"));
const Tours = lazy(() => import("./pages/Tours"));
const TourDetails = lazy(() => import("./pages/TourDetails"));
const Destinations = lazy(() => import("./pages/Destinations"));
const DestinationDetail = lazy(
  () => import("./pages/DestinationDetail"),
);
const Services = lazy(() => import("./pages/Services"));
const PlanMyTrip = lazy(() => import("./pages/PlanMyTrip"));
const Login = lazy(() => import("./pages/Login"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogDetail = lazy(() => import("./pages/BlogDetail"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Customer pages
const CustomerDashboard = lazy(
  () => import("./pages/CustomerDashboard"),
);
const CustomerAccount = lazy(
  () => import("./pages/CustomerAccount"),
);
const PaymentStatus = lazy(
  () => import("./pages/PaymentStatus"),
);
const CustomerOffers = lazy(
  () => import("./pages/CustomerOffers"),
);
const TravelAssistance = lazy(
  () => import("./pages/TravelAssistance"),
);
const CustomerSupport = lazy(
  () => import("./pages/CustomerSupport"),
);
const CustomerPreferences = lazy(
  () => import("./pages/CustomerPreferences"),
);
const NotificationCenter = lazy(
  () => import("./pages/NotificationCenter"),
);

// Admin pages
const AdminDashboard = lazy(
  () => import("./pages/AdminDashboard"),
);
const AdminCRM = lazy(() => import("./pages/AdminCRM"));
const AdminBookingOffer = lazy(
  () => import("./pages/AdminBookingOffer"),
);
const AdminTravelSupport = lazy(
  () => import("./pages/AdminTravelSupport"),
);
const AdminERP = lazy(() => import("./pages/AdminERP"));
const AdminERPAdministration = lazy(
  () => import("./pages/AdminERPAdministration"),
);
const AdminLocalizationSettings = lazy(
  () => import("./pages/AdminLocalizationSettings"),
);
const MarketingCampaigns = lazy(
  () => import("./pages/MarketingCampaigns"),
);
const KnowledgeBaseManager = lazy(
  () => import("./components/admin/KnowledgeBaseManager"),
);
const RecommendationAnalytics = lazy(
  () => import("./pages/RecommendationAnalytics"),
);
const AdminMapLocations = lazy(
  () => import("./pages/AdminMapLocations"),
);

// Shared site component
const FloatingTravelConcierge = lazy(
  () => import("./components/site/FloatingTravelConcierge"),
);

function SkipToMainContent() {
  return (
    <a className="skip-link" href="#main-content">
      Skip to main content
    </a>
  );
}


function Router() {
  useEffect(() => {
    const main = document.getElementById("main-content");

    if (main && !main.hasAttribute("tabindex")) {
      main.setAttribute("tabindex", "-1");
    }
  }, []);

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Home} />

      <Route path="/tours" component={Tours} />
      <Route path="/tours/:slug" component={TourDetails} />

      <Route path="/destinations" component={Destinations} />
      <Route
        path="/destinations/:slug"
        component={DestinationDetail}
      />

      <Route path="/services" component={Services} />
      <Route path="/services/:slug" component={Services} />

      <Route path="/plan-my-trip" component={PlanMyTrip} />

      <Route path="/login" component={Login} />

      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />

      <Route path="/search" component={SearchPage} />

      <Route path="/blog/:slug" component={BlogDetail} />
      <Route path="/blog" component={Blog} />

      <Route path="/404" component={NotFound} />

      {/* Customer routes */}
      <Route path="/dashboard/notifications">
        <ProtectedRoute>
          <NotificationCenter />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/travel-assistance">
        <ProtectedRoute>
          <TravelAssistance />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/support">
        <ProtectedRoute>
          <CustomerSupport />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/preferences">
        <ProtectedRoute>
          <CustomerPreferences />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/offers">
        <ProtectedRoute>
          <CustomerOffers />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard">
        <ProtectedRoute>
          <CustomerDashboard />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/:section">
        <ProtectedRoute>
          <CustomerAccount />
        </ProtectedRoute>
      </Route>

      <Route path="/payment-status">
        <ProtectedRoute>
          <PaymentStatus />
        </ProtectedRoute>
      </Route>

      {/* Admin routes */}
      <Route path="/admin/erp/administration">
        <ProtectedRoute requiredStaff>
          <AdminERPAdministration />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/erp">
        <ProtectedRoute requiredStaff>
          <AdminERP />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/localization">
        <ProtectedRoute requiredStaff>
          <AdminLocalizationSettings />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/map-locations">
        <ProtectedRoute requiredStaff>
          <AdminMapLocations />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/recommendation-analytics">
        <ProtectedRoute
          requiredStaff
          requiredPermission="reports.read"
        >
          <RecommendationAnalytics />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/notifications">
        <ProtectedRoute requiredStaff>
          <NotificationCenter />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/travel-support">
        <ProtectedRoute requiredStaff>
          <AdminTravelSupport />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/marketing/campaigns">
        <ProtectedRoute requiredStaff>
          <MarketingCampaigns />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/knowledge-base">
        <ProtectedRoute requiredStaff>
          <KnowledgeBaseManager />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/crm">
        <ProtectedRoute requiredStaff>
          <AdminCRM />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/booking-offers/new">
        <ProtectedRoute requiredStaff>
          <AdminBookingOffer />
        </ProtectedRoute>
      </Route>

      <Route path="/admin/booking-history">
        <ProtectedRoute requiredStaff>
          <AdminBookingsWorkspace />
        </ProtectedRoute>
      </Route>

      <Route path="/admin">
        <ProtectedRoute requiredStaff>
          <AdminDashboard />
        </ProtectedRoute>
      </Route>

      {/* Fallback */}
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <LanguageProvider>
            <CurrencyProvider>
              <TooltipProvider>
                <SkipToMainContent />

                <Toaster />
                  <Router />
                  <FloatingTravelConcierge />
                  
              </TooltipProvider>
            </CurrencyProvider>
          </LanguageProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
