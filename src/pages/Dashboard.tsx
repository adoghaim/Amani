import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Calendar } from '../components/Calendar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { SubscriptionStatus } from '../components/SubscriptionStatus';
import type { LabReport, PeriodLog, Intervention, Biomarker } from '../types';
import {
  FileText,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  Calendar as CalendarIcon,
  TrendingUp,
  Droplet,
  ArrowRight,
  TestTube2,
  X
} from 'lucide-react';

export function Dashboard() {
  const { user, userProfile } = useAuth();
  const [reports, setReports] = useState<LabReport[]>([]);
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [loading, setLoading] = useState(true);
  const [showContextNudge, setShowContextNudge] = useState(false);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const [reportsResult, periodLogsResult, interventionsResult] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('*')
          .order('report_date', { ascending: false }),
        supabase
          .from('period_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
        supabase
          .from('interventions')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
      ]);

      const fetchedReports = (!reportsResult.error && reportsResult.data)
        ? reportsResult.data as LabReport[]
        : [];

      setReports(fetchedReports);

      if (fetchedReports.length > 0) {
        const reportIds = fetchedReports.map((r) => r.id);
        const { data: biomarkersData } = await supabase
          .from('biomarkers')
          .select('*')
          .in('lab_report_id', reportIds);

        if (biomarkersData) {
          const grouped = (biomarkersData as Biomarker[]).reduce((acc, biomarker) => {
            if (!acc[biomarker.lab_report_id]) {
              acc[biomarker.lab_report_id] = [];
            }
            acc[biomarker.lab_report_id].push(biomarker);
            return acc;
          }, {} as Record<string, Biomarker[]>);
          setBiomarkersByReport(grouped);
        }
      }

      if (!periodLogsResult.error && periodLogsResult.data) {
        setPeriodLogs(periodLogsResult.data as PeriodLog[]);
      }

      if (!interventionsResult.error && interventionsResult.data) {
        setInterventions(interventionsResult.data as Intervention[]);
      }

      const hasReports = fetchedReports.length >= 1;
      const hasInterventions = (interventionsResult.data as Intervention[])?.length > 0;
      const hasPeriodLogs = (periodLogsResult.data as PeriodLog[])?.length > 0;

      if (hasReports && !hasInterventions && !hasPeriodLogs) {
        const nudgeDismissed = sessionStorage.getItem('contextNudgeDismissed');
        setShowContextNudge(!nudgeDismissed);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = async (date: string) => {
    const existingLog = periodLogs.find((p) => p.start_date === date);

    if (existingLog) {
      const confirmDelete = window.confirm('Remove period start marker from this date?');
      if (confirmDelete) {
        await supabase.from('period_logs').delete().eq('id', existingLog.id);
        await fetchData();
      }
    } else {
      const confirmAdd = window.confirm('Add period start marker to this date?');
      if (confirmAdd) {
        await supabase.from('period_logs').insert({
          user_id: user!.id,
          start_date: date,
        });
        await fetchData();
      }
    }
  };

  const isTrialActive = () => {
    if (!userProfile) return false;
    if (userProfile.subscription_status === 'active') return true;
    if (userProfile.subscription_status === 'trial') {
      const trialStart = new Date(userProfile.trial_start_date);
      const now = new Date();
      const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceStart < 7;
    }
    return false;
  };

  const getTrialDaysRemaining = (): number | null => {
    if (!userProfile || userProfile.subscription_status !== 'trial') return null;
    const trialStart = new Date(userProfile.trial_start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = 7 - daysSinceStart;
    return daysRemaining > 0 ? daysRemaining : 0;
  };

  const canCreateReport = userProfile?.subscription_status === 'active' || isTrialActive();
  const trialDaysRemaining = getTrialDaysRemaining();
  const showTrialBanner = trialDaysRemaining !== null && trialDaysRemaining <= 3;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processing':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'ready':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'processing':
        return 'Processing';
      case 'ready':
        return 'Ready';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  };

  const activeInterventions = interventions.filter(i => !i.end_date);
  const latestPeriodLog = periodLogs[0];
  const daysSinceLastPeriod = latestPeriodLog
    ? Math.floor((new Date().getTime() - new Date(latestPeriodLog.start_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const latestReport = reports[0];
  const daysSinceLastLab = latestReport
    ? Math.floor((new Date().getTime() - new Date(latestReport.report_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const calendarEvents = [
    ...reports.map((r) => ({
      date: r.report_date,
      type: 'lab' as const,
      label: r.lab_name || 'Lab report',
    })),
    ...periodLogs.map((p) => ({
      date: p.start_date,
      type: 'period_start' as const,
    })),
    ...periodLogs
      .filter((p) => !!p.end_date)
      .map((p) => ({
        date: p.end_date!,
        type: 'period_end' as const,
      })),
  ];

  const getCategoryColor = (category: string): string => {
    const colors: Record<string, string> = {
      supplement: 'bg-amber-100 text-amber-800 border-amber-200',
      diet: 'bg-green-100 text-green-800 border-green-200',
      exercise: 'bg-purple-100 text-purple-800 border-purple-200',
      medication: 'bg-red-100 text-red-800 border-red-200',
      sleep: 'bg-violet-100 text-violet-800 border-violet-200',
      other: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[category] || colors.other;
  };

  const handleDismissNudge = () => {
    sessionStorage.setItem('contextNudgeDismissed', 'true');
    setShowContextNudge(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <SubscriptionStatus />
        </div>
        
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-1">
              Health Dashboard
            </h1>
            <p className="text-gray-600">
              Your complete health tracking overview
            </p>
          </div>
          <a href="/app/new">
            <Button disabled={!canCreateReport}>
              <Plus className="w-5 h-5 mr-2" />
              New lab report
            </Button>
          </a>
        </div>

        {userProfile?.subscription_status !== 'active' && (
          <a href="/app/pricing" className="block mb-6">
            <div className="flex items-center justify-between gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-rose-300 hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
                  Founders Launch
                </span>
                <span className="text-sm text-gray-700 font-medium">
                  <span className="text-gray-400 line-through mr-1.5">$19.99/mo</span>
                  $9.99/mo &nbsp;&middot;&nbsp;
                  <span className="text-gray-400 line-through mr-1.5">$199.99/yr</span>
                  $99.99/yr
                </span>
              </div>
              <span className="text-sm font-medium text-rose-600 shrink-0">View pricing &rarr;</span>
            </div>
          </a>
        )}

        {showTrialBanner && (
          <Card className="mb-8 bg-gradient-to-r from-theme-surface-2 to-pink-50 border-theme-primary/30 shadow-md">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-theme-text mb-2">Keep your health timeline intact</h3>
                <p className="text-sm text-theme-muted-text mb-5">
                  Your insights improve as your data grows. {trialDaysRemaining === 1 ? '1 day' : `${trialDaysRemaining} days`} left in your trial.
                </p>
                <a href="/app/billing">
                  <Button>Continue tracking</Button>
                </a>
              </div>
            </div>
          </Card>
        )}

        {!canCreateReport && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-8">
            <p className="text-yellow-800">
              Your trial has expired. Please activate your subscription to create new reports.
            </p>
            <a href="/app/pricing" className="text-yellow-900 underline font-medium">
              View pricing
            </a>
          </div>
        )}

        {showContextNudge && (
          <Card className="mb-8 bg-gradient-to-r from-theme-surface-2 to-pink-50 border-theme-border shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-theme-text mb-2">Add context to your labs</h3>
                <p className="text-sm text-theme-muted-text mb-5">
                  Tracking even one change helps explain future results.
                </p>
                <div className="flex gap-3">
                  <a href="/app/tracker">
                    <Button size="sm">Add intervention</Button>
                  </a>
                  <a href="/app/tracker">
                    <Button size="sm" variant="ghost">Add cycle start</Button>
                  </a>
                </div>
              </div>
              <button
                onClick={handleDismissNudge}
                className="text-theme-muted-text hover:text-theme-text transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-theme-surface-2 to-pink-50 border-theme-border hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-theme-muted-text mb-2">Total Lab Reports</p>
                <p className="text-3xl font-bold text-theme-text">{reports.length}</p>
                {daysSinceLastLab !== null && (
                  <p className="text-xs text-theme-muted-text mt-2">
                    Last lab {daysSinceLastLab} days ago
                  </p>
                )}
              </div>
              <div className="bg-theme-primary/10 p-3 rounded-xl">
                <FileText className="w-6 h-6 text-theme-primary" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-theme-muted-text mb-2">Cycle Day</p>
                <p className="text-3xl font-bold text-theme-text">
                  {daysSinceLastPeriod !== null ? `Day ${daysSinceLastPeriod + 1}` : 'N/A'}
                </p>
                {latestPeriodLog && (
                  <p className="text-xs text-theme-muted-text mt-2">
                    Period started {formatDate(latestPeriodLog.start_date)}
                  </p>
                )}
              </div>
              <div className="bg-pink-200/50 p-3 rounded-xl">
                <Droplet className="w-6 h-6 text-pink-600" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-theme-muted-text mb-2">Active Interventions</p>
                <p className="text-3xl font-bold text-theme-text">{activeInterventions.length}</p>
                {activeInterventions.length > 0 && (
                  <p className="text-xs text-theme-muted-text mt-2">
                    Currently tracking
                  </p>
                )}
              </div>
              <div className="bg-purple-200/50 p-3 rounded-xl">
                <Activity className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-theme-muted-text mb-2">Periods Logged</p>
                <p className="text-3xl font-bold text-theme-text">{periodLogs.length}</p>
                <p className="text-xs text-theme-muted-text mt-2">
                  Tracked periods
                </p>
              </div>
              <div className="bg-green-200/50 p-3 rounded-xl">
                <CalendarIcon className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>
        </div>

        {reports.length > 0 && (
          <Card className="mb-8 bg-gradient-to-r from-theme-surface-2 to-pink-50 border-theme-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-theme-muted-text mb-3">Timeline Progress</h3>
                <div className="flex gap-8">
                  <div>
                    <span className="text-2xl font-bold text-theme-text">{reports.length}</span>
                    <span className="text-sm text-theme-muted-text ml-2">labs tracked</span>
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-theme-text">{interventions.length}</span>
                    <span className="text-sm text-theme-muted-text ml-2">interventions</span>
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-theme-text">{reports.length > 1 ? reports.length - 1 : 0}</span>
                    <span className="text-sm text-theme-muted-text ml-2">comparisons</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-theme-text">Your timeline gets smarter over time</p>
                <p className="text-xs text-theme-muted-text mt-1">Each lab adds to your health story</p>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Calendar & Cycle Tracking</h2>
              <a href="/app/tracker" className="text-sm text-theme-primary hover:text-theme-primary-dark font-medium flex items-center gap-1 transition-colors">
                View full tracker <ArrowRight className="w-4 h-4" />
              </a>
            </div>
            <Calendar events={calendarEvents} onDateClick={handleDateClick} />
            <div className="mt-3 p-3 bg-theme-surface-2 rounded-lg border border-theme-border">
              <p className="text-xs text-theme-muted-text">
                Click any date to add or remove period markers. Lab reports are automatically displayed.
              </p>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Active Interventions</h2>
              <a href="/app/tracker" className="text-sm text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
                Manage
              </a>
            </div>
            {activeInterventions.length === 0 ? (
              <Card className="border-dashed">
                <div className="text-center py-8 text-gray-600">
                  <Activity className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm">No active interventions</p>
                  <a href="/app/tracker" className="text-sm text-theme-primary hover:text-theme-primary-dark mt-2 inline-block transition-colors">
                    Start tracking
                  </a>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {activeInterventions.slice(0, 5).map((intervention) => (
                  <Card key={intervention.id} className="hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 text-sm truncate">
                          {intervention.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getCategoryColor(intervention.category)}`}>
                            {intervention.category}
                          </span>
                          <span className="text-xs text-gray-500">
                            Since {formatDate(intervention.start_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {activeInterventions.length > 5 && (
                  <a href="/app/tracker" className="block text-center text-sm text-theme-primary hover:text-theme-primary-dark py-2 transition-colors">
                    View {activeInterventions.length - 5} more
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Recent Lab Reports</h2>
            <a href="/app/tracker" className="text-sm text-theme-primary hover:text-theme-primary-dark font-medium flex items-center gap-1 transition-colors">
              View timeline <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {reports.length === 0 ? (
            <Card className="border-dashed">
              <div className="text-center py-12">
                <TestTube2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No lab reports yet
                </h2>
                <p className="text-gray-600 mb-6">
                  Create your first lab report to get started.
                </p>
                {canCreateReport && (
                  <a href="/app/new">
                    <Button>
                      <Plus className="w-5 h-5 mr-2" />
                      New lab report
                    </Button>
                  </a>
                )}
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reports.slice(0, 6).map((report) => (
                <a
                  key={report.id}
                  href={`/app/reports/${report.id}`}
                  className="block"
                >
                  <Card className="hover:shadow-lg transition-all cursor-pointer border-l-4 border-l-theme-primary">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="bg-theme-primary/10 p-2 rounded-lg">
                          <FileText className="w-5 h-5 text-theme-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 text-sm">
                            {formatDate(report.report_date)}
                          </div>
                          <div className="text-xs text-gray-600 flex items-center gap-2 mt-1 flex-wrap">
                            {getStatusIcon(report.status)}
                            <span>{getStatusText(report.status)}</span>
                            {report.estimated_cycle_phase !== 'unknown' && (
                              <>
                                <span>•</span>
                                <span className="capitalize">{report.estimated_cycle_phase}</span>
                              </>
                            )}
                          </div>
                          {biomarkersByReport[report.id] && (
                            <div className="text-xs text-gray-500 mt-2">
                              {biomarkersByReport[report.id].length} biomarkers
                            </div>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </Card>
                </a>
              ))}
            </div>
          )}

          {reports.length > 6 && (
            <div className="mt-4 text-center">
              <a href="/app/tracker" className="text-theme-primary hover:text-theme-primary-dark font-medium text-sm transition-colors">
                View all {reports.length} lab reports
              </a>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
