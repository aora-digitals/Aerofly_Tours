import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";

import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./contexts/AuthContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { ThemeProvider } from "./contexts/ThemeContext";

import Home from "./pages/Home";
import Tours from "./pages/Tours";
import TourDetails from "./pages/TourDetails";
import Destinations from "./pages/Destinations";
import DestinationDetail from "./pages/DestinationDetail";
import Services from "./pages/Services";
import PlanMyTrip from "./pages/PlanMyTrip";
import CustomerDashboard from "./pages/CustomerDashboard";
import CustomerAccount from "./pages/CustomerAccount";
import PaymentStatus from "./pages/PaymentStatus";
import AdminDashboard from "./pages/AdminDashboard";
import AdminCRM from "./pages/AdminCRM";
import Login from "./pages/Login";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Blog from "./pages/Blog";
import BlogDetail from "./pages/BlogDetail";
import SearchPage from "./pages/SearchPage";
import NotFound from "./pages/NotFound";
import CustomerOffers from "./pages/CustomerOffers";
import AdminBookingOffer from "./pages/AdminBookingOffer";
import TravelAssistance from "./pages/TravelAssistance";
import CustomerSupport from "./pages/CustomerSupport";
import AdminTravelSupport from "./pages/AdminTravelSupport";
import NotificationCenter from "./pages/NotificationCenter";
import AdminERP from "./pages/AdminERP";
import AdminERPAdministration from "./pages/AdminERPAdministration";
import MarketingCampaigns from "./pages/MarketingCampaigns";
import FloatingTravelConcierge from "./components/site/FloatingTravelConcierge";

import ProtectedRoute from "./components/auth/ProtectedRoute";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />

      <Route path="/tours" component={Tours} />

      <Route
        path="/tours/:slug"
        component={TourDetails}
      />

      <Route
        path="/destinations"
        component={Destinations}
      />

      <Route
        path="/destinations/:slug"
        component={DestinationDetail}
      />

      <Route path="/services" component={Services} />

      <Route
        path="/services/:slug"
        component={Services}
      />

      <Route
        path="/plan-my-trip"
        component={PlanMyTrip}
      />

      <Route path="/dashboard/notifications">
        <ProtectedRoute>
          <NotificationCenter />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard">
        <ProtectedRoute>
          <CustomerDashboard />
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

      <Route path="/login" component={Login} />

      <Route path="/admin">
        <ProtectedRoute requiredStaff>
          <AdminDashboard />
        </ProtectedRoute>
      </Route>

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

      <Route path="/admin/crm">
        <ProtectedRoute requiredStaff>
          <AdminCRM />
        </ProtectedRoute>
      </Route>

      <Route path="/dashboard/offers">
  <ProtectedRoute>
    <CustomerOffers />
  </ProtectedRoute>
</Route>

<Route path="/admin/booking-offers/new">
  <ProtectedRoute requiredStaff>
    <AdminBookingOffer />
  </ProtectedRoute>
</Route>

      <Route path="/about" component={About} />

      <Route path="/contact" component={Contact} />

      <Route path="/search" component={SearchPage} />

      <Route
        path="/blog/:slug"
        component={BlogDetail}
      />

      <Route path="/blog" component={Blog} />

      <Route path="/404" component={NotFound} />

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <CurrencyProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
               <FloatingTravelConcierge />
            </TooltipProvider>
          </CurrencyProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}