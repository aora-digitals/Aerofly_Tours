import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import Home from "./pages/Home";
import Tours from "./pages/Tours";
import TourDetails from "./pages/TourDetails";
import Destinations from "./pages/Destinations";
import DestinationDetail from "./pages/DestinationDetail";
import Services from "./pages/Services";
import PlanMyTrip from "./pages/PlanMyTrip";
import CustomerDashboard from "./pages/CustomerDashboard";
import PaymentStatus from "./pages/PaymentStatus";
import AdminDashboard from "./pages/AdminDashboard";
import Login from "./pages/Login";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Blog from "./pages/Blog";
import BlogDetail from "./pages/BlogDetail";
import SearchPage from "./pages/SearchPage";
import NotFound from "./pages/NotFound";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/tours" component={Tours} />
    <Route path="/tours/:slug" component={TourDetails} />
    <Route path="/destinations" component={Destinations} />
    <Route path="/destinations/:slug" component={DestinationDetail} />
    <Route path="/services" component={Services} />
    <Route path="/services/:slug" component={Services} />
    <Route path="/plan-my-trip" component={PlanMyTrip} />
    <Route path="/dashboard" component={CustomerDashboard} />
    <Route path="/payment-status" component={PaymentStatus} />
    <Route path="/login" component={Login} />
    <Route path="/admin" component={AdminDashboard} />
    <Route path="/about" component={About} />
    <Route path="/contact" component={Contact} />
    <Route path="/search" component={SearchPage} />
    <Route path="/blog/:slug" component={BlogDetail} />
    <Route path="/blog" component={Blog} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><CurrencyProvider><TooltipProvider><Toaster /><Router /></TooltipProvider></CurrencyProvider></ThemeProvider></ErrorBoundary>;
}
