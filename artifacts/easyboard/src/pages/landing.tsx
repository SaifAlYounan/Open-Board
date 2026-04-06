import { Link } from "wouter";
import { Lock, Book, Bot, Shield, DollarSign, Zap, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-[#1d1d1f] text-white flex flex-col font-sans">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-50 bg-[#1d1d1f]/90 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-sm font-bold">
            ✦
          </div>
          <span className="text-sm font-semibold text-white">EasyBoard v2</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/whitepaper">
            <button className="text-sm text-[#86868b] hover:text-white transition-colors px-3 py-1.5">
              Security
            </button>
          </Link>
          <Link href="/login">
            <button
              className="flex items-center gap-1.5 text-sm font-medium bg-[#0071e3] hover:bg-[#0077ed] text-white px-4 py-2 rounded-full transition-colors"
              data-testid="nav-secretary-portal"
            >
              Secretary Portal
              <ArrowRight size={14} />
            </button>
          </Link>
        </nav>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20 text-center">
        <div className="space-y-6 max-w-3xl">
          <h1 className="text-2xl md:text-3xl font-medium tracking-tight text-white mb-12">✦ EasyBoard v2</h1>
          
          <h2 className="text-5xl md:text-7xl font-semibold tracking-tighter leading-tight text-white mb-6">
            The AI is the Secretary. <br />You just approve.
          </h2>
          
          <p className="text-xl md:text-2xl text-[#86868b] max-w-2xl mx-auto mb-12 tracking-tight">
            The first AI-native board management platform. Open source. Self-hosted.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/login" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white border-0" data-testid="button-enter">
                Enter &rarr;
              </Button>
            </Link>
            <Link href="/whitepaper" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto text-lg h-14 px-8 rounded-full bg-transparent border-[#86868b] text-white hover:bg-white/10"
                data-testid="button-source"
              >
                Is this secure?
              </Button>
            </Link>
            <Link href="/how-it-works" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto text-lg h-14 px-8 rounded-full bg-transparent border-[#86868b] text-white hover:bg-white/10 flex items-center gap-2"
                data-testid="button-how-it-works"
              >
                <Info size={18} />
                How it works
              </Button>
            </Link>
          </div>

          <p className="text-sm text-[#86868b] max-w-lg mx-auto pt-2 leading-relaxed">
            Legacy vendors will tell you that open source is not secure. That is not true.{" "}
            <Link href="/whitepaper">
              <span className="text-[#0071e3] hover:underline cursor-pointer">Read the white paper</span>
            </Link>{" "}
            and discuss it with your cyber security team.
          </p>
        </div>
      </main>

      <section className="py-24 px-4 bg-[#1d1d1f] border-t border-white/10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard icon={<Lock className="w-6 h-6" />} title="Self-hosted" description="Runs on your servers" />
          <FeatureCard icon={<Book className="w-6 h-6" />} title="100% open source" description="Audit every line" />
          <FeatureCard icon={<Bot className="w-6 h-6" />} title="AI-native" description="The AI bar is the interface" />
          <FeatureCard icon={<Shield className="w-6 h-6" />} title="Tamper-proof" description="SHA-256 on everything" />
          <FeatureCard icon={<DollarSign className="w-6 h-6" />} title="No per-seat pricing" description="Unlimited users" />
          <FeatureCard icon={<Zap className="w-6 h-6" />} title="Deploy in 3 commands" description="Docker ready" />
        </div>
      </section>

      <footer className="py-8 text-center text-[#86868b] text-sm border-t border-white/10">
        <p data-testid="text-footer">EasyBoard v2 | MIT License</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-white/5 p-8 rounded-2xl border border-white/10 flex flex-col items-center text-center hover:bg-white/10 transition-colors duration-300" data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="w-12 h-12 bg-[#0071e3]/20 text-[#0071e3] rounded-full flex items-center justify-center mb-6">
        {icon}
      </div>
      <h3 className="text-xl font-semibold mb-2 text-white">{title}</h3>
      <p className="text-[#86868b]">{description}</p>
    </div>
  );
}
