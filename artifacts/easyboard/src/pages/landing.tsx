import { Link } from "wouter";
import { Lock, Book, Bot, Shield, DollarSign, Zap, ArrowRight } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-[#f5f5f7] text-[#1d1d1f] flex flex-col font-sans">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#e5e5e7] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-sm font-bold">
            ✦
          </div>
          <span className="text-sm font-semibold text-[#1d1d1f]">Open Board</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/whitepaper">
            <button className="text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors px-3 py-1.5">
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
          <div className="inline-flex items-center gap-2 bg-[#0071e3]/10 text-[#0071e3] text-xs font-semibold px-3 py-1.5 rounded-full tracking-wide uppercase">
            <Bot size={12} />
            AI-native board governance
          </div>

          <h1 className="text-5xl md:text-7xl font-semibold tracking-tighter leading-tight text-[#1d1d1f]">
            The AI is the Secretary.<br />You just approve.
          </h1>

          <p className="text-xl md:text-2xl text-[#86868b] max-w-2xl mx-auto tracking-tight">
            The first AI-native board management platform.<br />Open source. Self-hosted. No per-seat pricing.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/how-it-works" className="w-full sm:w-auto">
              <button
                className="w-full sm:w-auto flex items-center justify-center gap-2 text-lg h-14 px-8 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white transition-colors font-medium"
                data-testid="button-enter"
              >
                Try the Demo
                <ArrowRight size={18} />
              </button>
            </Link>
            <Link href="/whitepaper" className="w-full sm:w-auto">
              <button
                className="w-full sm:w-auto text-lg h-14 px-8 rounded-full bg-white border border-[#e5e5e7] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors font-medium"
                data-testid="button-source"
              >
                Is this secure?
              </button>
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

      <section className="py-20 px-4 border-t border-[#e5e5e7] bg-white">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <FeatureCard icon={<Lock className="w-5 h-5" />} title="Self-hosted" description="Runs entirely on your servers. Your data never leaves your infrastructure." />
          <FeatureCard icon={<Book className="w-5 h-5" />} title="100% open source" description="Audit every line of code. No black boxes, no proprietary logic." />
          <FeatureCard icon={<Bot className="w-5 h-5" />} title="AI-native" description="Upload a document and the AI does the governance work. You review and approve." />
          <FeatureCard icon={<Shield className="w-5 h-5" />} title="Tamper-proof" description="SHA-256 on every vote certificate and minute signature. Cryptographically verifiable." />
          <FeatureCard icon={<DollarSign className="w-5 h-5" />} title="No per-seat pricing" description="Unlimited users, unlimited boards. Pay only for your server and AI API calls." />
          <FeatureCard icon={<Zap className="w-5 h-5" />} title="Your choice of AI" description="Claude via the Anthropic API with your own key, or a fully local OpenAI-compatible model (Ollama, vLLM, LM Studio) so documents never leave your network." />
        </div>
      </section>

      <footer className="py-8 text-center text-[#86868b] text-sm border-t border-[#e5e5e7] bg-white">
        <p data-testid="text-footer">Open Board &nbsp;·&nbsp; MIT License</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div
      className="bg-white p-7 rounded-2xl border border-[#e5e5e7] flex flex-col items-start text-left hover:border-[#0071e3]/30 hover:shadow-sm transition-all duration-200"
      data-testid={`card-feature-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="w-10 h-10 bg-[#0071e3]/10 text-[#0071e3] rounded-xl flex items-center justify-center mb-5">
        {icon}
      </div>
      <h3 className="text-base font-semibold mb-1.5 text-[#1d1d1f]">{title}</h3>
      <p className="text-sm text-[#86868b] leading-relaxed">{description}</p>
    </div>
  );
}
