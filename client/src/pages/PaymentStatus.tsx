import  {
     ArrowLeft,
     CalendarDays,
     CheckCircle2,
     Clock3,
     CreditCard,
     FileText,
     Plane,
     Receipt,
     ShieldCheck,
     UserRound,
     XCircle 
} from "lucide-react";
 import  {
     Link 
} from "wouter";
 import  {
     useAuth 
} from "@/_core/hooks/useAuth";
 import Header from "@/components/site/Header";
 import Footer from "@/components/site/Footer";
 import  {
     trpc 
} from "@/lib/trpc";
 const bookingSteps = ["pending",
 "confirmed",
 "in_progress",
 "completed"] as const;
 const bookingLabels: Record<string,
 string> =  {
     pending: "Awaiting confirmation",
     confirmed: "Confirmed",
     in_progress: "In progress",
     completed: "Completed",
     cancelled: "Cancelled" 
};
 export default function PaymentStatus()  {
     const  {
         user,
         loading,
         isAuthenticated 
    } = useAuth();
     const  {
         data,
         isLoading 
    } = trpc.customer.dashboard.useQuery(undefined,
      {
         enabled: isAuthenticated 
    });
     if (loading || (isAuthenticated && isLoading)) return <><Header /><div className="container py-32 text-center text-[14px] text-[#6f6c66]">Loading payment status…</div></>;
     if (!isAuthenticated) return <><Header /><main className="bg-[#f3ede5]"><div className="container grid min-h-[650px] place-items-center py-20"><div className="card max-w-[440px] p-9 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]"><UserRound size= {
        23
    } /></div><h1 className="mt-6 font-['Manrope'] text-3xl font-extrabold">Track your AeroFly payments.</h1><p className="mt-3 text-[14px] leading-6 text-[#6f6c66]">Sign in to view receipts,
     payment status,
     and the current progress of every booking.</p>
     <button
  onClick={() => {
    window.location.assign(
      "/login?next=%2Fpayment-status"
    );
  }}
  className="btn btn-primary mt-7 w-full"
>
  Sign in to view status
</button>
    </div>
    </div>
    </main>
    <Footer />
    </>;

     const payments = data?.payments ?? [];
     const bookings = data?.bookings ?? [];
     return <div className="min-h-screen">
      <Header />
      <main className="bg-[#f3ede5] py-12 sm:py-16">
        <div className="container"><Link href="/dashboard" className="inline-flex items-center gap-2 text-[12px] font-bold text-[#77736c] hover:text-[#c94d1c]"><ArrowLeft size= {
        14
    } /> Back to travel desk</Link><div className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="eyebrow">Payment & booking status</div><h1 className="display mt-3 text-4xl font-extrabold sm:text-6xl">Your journey,
     tracked.</h1><p className="mt-4 max-w-2xl text-[14px] leading-6 text-[#6f6c66]">Hello  {
        user?.name?.split(" ")[0] ?? "traveller"
    }. See every payment reference and exactly where your booking stands.</p></div><div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold text-[#3f7b4b]"><ShieldCheck size= {
        15
    } /> Secure payment records</div></div><section className="mt-10 grid gap-4 sm:grid-cols-3"><StatusMetric icon= {
        CreditCard
    } label="Transactions" value= {
        String(payments.length)
    } /><StatusMetric icon= {
        Plane
    } label="Bookings" value= {
        String(bookings.length)
    } /><StatusMetric icon= {
        CheckCircle2
    } label="Successful payments" value= {
        String(payments.filter(( {
             payment 
        }) => payment.status === "successful").length)
    } /></section><section className="card mt-8 bg-[#fbfaf8] p-6 sm:p-8"><div className="flex items-center justify-between"><div><div className="eyebrow">Transaction history</div><h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">Receipts and payment status.</h2></div><Receipt size= {
        20
    } className="text-[#f26b35]" /></div> {
        payments.length === 0 ? <Empty label="No transactions yet" copy="Once you pay an accepted quotation, your receipt and current status will appear here." /> : <div className="mt-7 space-y-4"> {
            payments.map(( {
                 payment,
                 quotation,
                 booking 
            }) => <article key= {
                payment.id
            } className="rounded-xl border border-[#e8e4dd] bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><span className="font-['Manrope'] text-[15px] font-extrabold"> {
                payment.reference
            }</span><PaymentBadge status= {
                payment.status
            } /></div><div className="mt-2 text-[12px] text-[#77736c]"> {
                quotation?.destination ?? booking?.destination ?? "AeroFly journey"
            } ·  {
                payment.method.replace("_",
                 " ")
            }</div></div><div className="text-left sm:text-right"><div className="font-['Manrope'] text-xl font-extrabold">₹ {
                Number(payment.amount).toLocaleString("en-IN")
            }</div><div className="mt-1 flex items-center gap-1 text-[11px] text-[#92928b]"><CalendarDays size= {
                12
            } /> {
                new Date(payment.paidAt).toLocaleDateString()
            }</div></div></div> {
                booking ? <div className="mt-5 border-t border-[#eee9e1] pt-5"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.13em] text-[#92928b]">Booking  {
                    booking.reference
                }</div><div className="mt-1 text-[13px] font-bold"> {
                    bookingLabels[booking.bookingStatus] ?? booking.bookingStatus
                }</div></div><span className="rounded-full bg-[#e9f5ed] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#3f7b4b]">Payment  {
                    booking.paymentStatus
                }</span></div> {
                    booking.bookingStatus !== "cancelled" && <div className="mt-5 grid grid-cols-4 gap-2"> {
                        bookingSteps.map((step,
                         index) =>  {
                             const current = bookingSteps.indexOf(booking.bookingStatus as typeof bookingSteps[number]);
                             const complete = current >= index;
                             return <div key= {
                                step
                            }><div className= {
                                `h-1.5 rounded-full ${complete ? "bg-[#f26b35]" : "bg-[#e8e4dd]"}`
                            } /><div className= {
                                `mt-2 text-[9px] font-bold uppercase tracking-[.08em] ${complete ? "text-[#c94d1c]" : "text-[#b4b0aa]"}`
                            }> {
                                bookingLabels[step]
                            }</div></div>;
                        })
                    }</div>
                } {
                    booking.bookingStatus === "cancelled" && <div className="mt-4 flex items-center gap-2 text-[12px] font-semibold text-[#b14a34]"><XCircle size= {
                        14
                    } /> This booking has been cancelled. Contact the travel desk for assistance.</div>
                }</div> : <div className="mt-5 flex items-center gap-2 border-t border-[#eee9e1] pt-4 text-[12px] text-[#77736c]"><Clock3 size= {
                    14
                } className="text-[#f26b35]" /> Payment received;
                 booking confirmation is being coordinated by the travel desk.</div>
            }</article>)
        }</div>
    }</section><BookingProgress bookings= {
        bookings
    } /><div className="mt-6 grid gap-6 md:grid-cols-2"><InfoCard icon= {
        FileText
    } title="Need a receipt copy?" copy="Your transaction reference is the official AeroFly payment reference. Contact customer care if you need a PDF receipt or invoice." /><InfoCard icon= {
        ShieldCheck
    } title="Payment safety" copy="Card details are handled by Stripe. AeroFly stores only the payment references needed to reconcile your booking." /></div></div></main><Footer /></div>;
} function BookingProgress( {
     bookings 
}:  {
     bookings: Array< {
         id: number;
         reference: string;
         destination: string;
         travelDates: string;
         travellers: number;
         bookingStatus: string;
         paymentStatus: string 
    }> 
})  {
     return <section className="card mt-6 bg-[#fbfaf8] p-6 sm:p-8"><div className="flex items-center justify-between"><div><div className="eyebrow">Booking progress</div><h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">Your travel desk is coordinating.</h2></div><Plane size= {
        20
    } className="text-[#f26b35]" /></div> {
        bookings.length === 0 ? <Empty label="No bookings yet" copy="A booking will appear here after your accepted quotation is converted by the travel desk." /> : <div className="mt-7 grid gap-4 md:grid-cols-2"> {
            bookings.map((booking) => <div key= {
                booking.id
            } className="rounded-xl border border-[#e8e4dd] bg-white p-5"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.13em] text-[#92928b]"> {
                booking.reference
            }</div><div className="mt-2 font-['Manrope'] text-[16px] font-extrabold"> {
                booking.destination
            }</div><div className="mt-1 text-[12px] text-[#77736c]"> {
                booking.travelDates
            } ·  {
                booking.travellers
            } traveller {
                booking.travellers === 1 ? "" : "s"
            }</div></div><span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold uppercase text-[#4e79a7]"> {
                bookingLabels[booking.bookingStatus] ?? booking.bookingStatus
            }</span></div><div className="mt-5 flex items-center justify-between border-t border-[#eee9e1] pt-4 text-[11px]"><span className="text-[#77736c]">Payment: <strong className="capitalize"> {
                booking.paymentStatus
            }</strong></span><span className="font-bold text-[#c94d1c]">Travel desk update</span></div></div>)
        }</div>
    }</section>;
} function StatusMetric( {
     icon: Icon,
     label,
     value 
}:  {
     icon: typeof CreditCard;
     label: string;
     value: string 
})  {
     return <div className="card bg-[#fbfaf8] p-5"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#92928b]"> {
        label
    }</span><Icon size= {
        16
    } className="text-[#f26b35]" /></div><div className="mt-4 font-['Manrope'] text-3xl font-extrabold tracking-[-.05em]"> {
        value
    }</div></div>;
} function PaymentBadge( {
     status 
}:  {
     status: string 
})  {
     const styles = status === "successful" ? "bg-[#e9f5ed] text-[#3f7b4b]" : status === "pending" ? "bg-[#fff7df] text-[#9a6b16]" : "bg-[#fff0ec] text-[#b14a34]";
     return <span className= {
        `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] ${styles}`
    }> {
        status === "successful" ? <CheckCircle2 size= {
            12
        } /> : status === "pending" ? <Clock3 size= {
            12
        } /> : <XCircle size= {
            12
        } />
    } {
        status
    }</span>;
} function InfoCard( {
     icon: Icon,
     title,
     copy 
}:  {
     icon: typeof FileText;
     title: string;
     copy: string 
})  {
     return <div className="card bg-[#fbfaf8] p-6"><Icon size= {
        18
    } className="text-[#f26b35]" /><h3 className="mt-4 font-['Manrope'] text-[16px] font-extrabold"> {
        title
    }</h3><p className="mt-2 text-[12px] leading-5 text-[#77736c]"> {
        copy
    }</p></div>;
} function Empty( {
     label,
     copy 
}:  {
     label: string;
     copy: string 
})  {
     return <div className="mt-8 rounded-xl bg-[#f3ede5] p-7 text-center"><h3 className="font-['Manrope'] text-[16px] font-extrabold"> {
        label
    }</h3><p className="mt-2 text-[13px] leading-6 text-[#77736c]"> {
        copy
    }</p></div>;
}