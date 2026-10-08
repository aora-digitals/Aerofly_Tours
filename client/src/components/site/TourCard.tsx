import { ArrowUpRight, Clock3, Heart, MapPin, Star } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { addToWishlist, isTourWishlisted, removeFromWishlist } from "@/lib/customer";

type Tour = { id?: number; slug: string; title: string; destination: string; country: string; durationDays: number; durationNights: number; priceFrom: string | number; originalPrice?: string | number | null; rating: string | number; reviewCount: number; imageUrl: string; tags?: string | string[] | null; category?: string; availability?: string };

export default function TourCard({ tour }: { tour: Tour }) {
  const price = Number(tour.priceFrom);
  const original = tour.originalPrice ? Number(tour.originalPrice) : 0;
  const { format, currency } = useCurrency();
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !tour.id) { setSaved(false); return; }
    void isTourWishlisted(user.id, tour.id).then(setSaved).catch(() => undefined);
  }, [user?.id, tour.id]);

  const toggleWishlist = async () => {
    if (!isAuthenticated || !user) {
      navigate(`/login?next=${encodeURIComponent(`/tours/${tour.slug}`)}`);
      return;
    }
    if (!tour.id || saving) return;
    setSaving(true);
    try {
      if (saved) {
        await removeFromWishlist(user.id, tour.id);
        setSaved(false);
        toast.success("Removed from wishlist.");
      } else {
        await addToWishlist(user.id, tour.id);
        setSaved(true);
        toast.success("Saved to your wishlist.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update wishlist.");
    } finally { setSaving(false); }
  };

  return <article className="card card-lift group overflow-hidden">
    <div className="relative h-[220px] overflow-hidden"><img src={tour.imageUrl} alt={`${tour.title} in ${tour.destination}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" /><span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-[#c94d1c]">{tour.category ?? "Curated journey"}</span><button type="button" aria-label={saved ? "Remove tour from wishlist" : "Save tour"} disabled={saving} onClick={() => void toggleWishlist()} className={`absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full backdrop-blur transition ${saved ? "bg-white text-[#f26b35]" : "bg-black/20 text-white hover:bg-white hover:text-[#f26b35]"}`}><Heart size={16} className={saved ? "fill-current" : ""} /></button><div className="absolute bottom-4 left-4 flex items-center gap-1 text-[12px] font-semibold text-white"><MapPin size={13} />{tour.destination}, {tour.country}</div></div>
    <div className="p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-['Manrope'] text-[19px] font-extrabold leading-tight tracking-[-.04em]">{tour.title}</h3><div className="flex shrink-0 items-center gap-1 text-[12px] font-bold"><Star size={13} className="fill-[#f26b35] text-[#f26b35]" /> {tour.rating}</div></div><div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-[#77736c]"><span className="flex items-center gap-1"><Clock3 size={13} /> {tour.durationDays} days / {tour.durationNights} nights</span><span>·</span><span>{tour.reviewCount} reviews</span></div><div className="mt-5 flex items-end justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#908b83]">Starting from</div><div className="mt-1 flex items-baseline gap-2"><strong className="font-['Manrope'] text-[21px] font-extrabold">{format(price)}</strong>{original > price && <del className="text-[11px] text-[#a29d95]">{format(original)}</del>}</div><div className="mt-1 text-[10px] text-[#92928b]">{currency} display · base price INR</div></div><Link href={`/tours/${tour.slug}`} className="grid h-10 w-10 place-items-center rounded-full bg-[#fff0e8] text-[#c94d1c] transition group-hover:bg-[#f26b35] group-hover:text-white" aria-label={`View ${tour.title}`}><ArrowUpRight size={17} /></Link></div><div className="mt-4 border-t border-[#eee9e1] pt-3 text-[11px] font-semibold text-[#77736c]">{tour.availability ?? "Availability on request"}</div></div>
  </article>;
}
