import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/landing";
import Login from "@/pages/login";
import Whitepaper from "@/pages/whitepaper";
import HowItWorks from "@/pages/how-it-works";

import SecretaryDashboard from "@/pages/secretary/index";
import SecretaryPendingActions from "@/pages/secretary/pending";
import SecretaryVotes from "@/pages/secretary/votes";
import SecretaryVoteDetail from "@/pages/secretary/vote-detail";
import SecretaryMeetings from "@/pages/secretary/meetings";
import SecretaryMeetingDetail from "@/pages/secretary/meeting-detail";
import SecretaryMinutesList from "@/pages/secretary/minutes";
import MinutesEditor from "@/pages/secretary/minutes-editor";
import SecretaryTasks from "@/pages/secretary/tasks";
import SecretaryTaskDetail from "@/pages/secretary/task-detail";
import SecretaryDocuments from "@/pages/secretary/documents";
import SecretaryMembers from "@/pages/secretary/members";
import SecretarySettings from "@/pages/secretary/settings";
import SecretaryAdmin from "@/pages/secretary/admin";
import SecretaryWorkflows from "@/pages/secretary/workflows";
import WorkflowDetail from "@/pages/secretary/workflow-detail";

import BoardMemberDashboard from "@/pages/board/index";
import BoardRoom from "@/pages/board/room";
import BoardMeetingDetail from "@/pages/board/meeting-detail";
import MinutesViewer from "@/pages/board/minutes-viewer";
import MinutesSigning from "@/pages/board/signing";
import VoteCertificate from "@/pages/board/vote-certificate";

import ManagementDashboard from "@/pages/management/index";
import TaskDetail from "@/pages/management/task-detail";
import ManagementTasks from "@/pages/management/tasks";
import ManagementMinutes from "@/pages/management/minutes";

import ObserverDashboard from "@/pages/observer/index";
import ObserverRoom from "@/pages/observer/room";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="text-[#86868b] text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (roles && !roles.includes(user.role)) {
    const redirectMap: Record<string, string> = {
      admin: '/secretary',
      member: '/board',
      management: '/management',
      observer: '/observer',
    };
    return <Redirect to={redirectMap[user.role] || '/'} />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/whitepaper" component={Whitepaper} />
      <Route path="/how-it-works" component={HowItWorks} />

      {/* Secretary routes */}
      <Route path="/secretary">
        <ProtectedRoute roles={['admin']}>
          <SecretaryDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/pending">
        <ProtectedRoute roles={['admin']}>
          <SecretaryPendingActions />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/workflows/:id">
        {() => (
          <ProtectedRoute roles={['admin']}>
            <WorkflowDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/secretary/workflows">
        <ProtectedRoute roles={['admin']}>
          <SecretaryWorkflows />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/votes/:id">
        {() => (
          <ProtectedRoute roles={['admin']}>
            <SecretaryVoteDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/secretary/votes">
        <ProtectedRoute roles={['admin']}>
          <SecretaryVotes />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/meetings/:id">
        {() => (
          <ProtectedRoute roles={['admin']}>
            <SecretaryMeetingDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/secretary/meetings">
        <ProtectedRoute roles={['admin']}>
          <SecretaryMeetings />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/minutes">
        <ProtectedRoute roles={['admin']}>
          <SecretaryMinutesList />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/minutes/:id">
        {(params) => (
          <ProtectedRoute roles={['admin']}>
            <MinutesEditor />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/secretary/tasks/:id">
        {() => (
          <ProtectedRoute roles={['admin']}>
            <SecretaryTaskDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/secretary/tasks">
        <ProtectedRoute roles={['admin']}>
          <SecretaryTasks />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/documents">
        <ProtectedRoute roles={['admin']}>
          <SecretaryDocuments />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/members">
        <ProtectedRoute roles={['admin']}>
          <SecretaryMembers />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/admin">
        <ProtectedRoute roles={['admin']}>
          <SecretaryAdmin />
        </ProtectedRoute>
      </Route>
      <Route path="/secretary/settings">
        <ProtectedRoute roles={['admin']}>
          <SecretarySettings />
        </ProtectedRoute>
      </Route>

      {/* Board member routes */}
      <Route path="/board">
        <ProtectedRoute roles={['member']}>
          <BoardMemberDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/board/room/:boardId">
        {(params) => (
          <ProtectedRoute roles={['member']}>
            <BoardRoom />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/board/meetings/:id">
        {() => (
          <ProtectedRoute roles={['member']}>
            <BoardMeetingDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/board/minutes/:id">
        {(params) => (
          <ProtectedRoute roles={['member', 'observer', 'management']}>
            <MinutesViewer />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/board/minutes/:id/sign">
        {(params) => (
          <ProtectedRoute roles={['member']}>
            <MinutesSigning />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/board/vote/:id">
        {() => (
          <ProtectedRoute roles={['member']}>
            <VoteCertificate />
          </ProtectedRoute>
        )}
      </Route>

      {/* Management routes */}
      <Route path="/management">
        <ProtectedRoute roles={['management']}>
          <ManagementDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/management/tasks">
        <ProtectedRoute roles={['management']}>
          <ManagementTasks />
        </ProtectedRoute>
      </Route>
      <Route path="/management/minutes">
        <ProtectedRoute roles={['management']}>
          <ManagementMinutes />
        </ProtectedRoute>
      </Route>
      <Route path="/management/task/:id">
        {(params) => (
          <ProtectedRoute roles={['management']}>
            <TaskDetail />
          </ProtectedRoute>
        )}
      </Route>

      {/* Observer routes */}
      <Route path="/observer">
        <ProtectedRoute roles={['observer']}>
          <ObserverDashboard />
        </ProtectedRoute>
      </Route>
      <Route path="/observer/room/:boardId">
        {(params) => (
          <ProtectedRoute roles={['observer']}>
            <ObserverRoom />
          </ProtectedRoute>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
