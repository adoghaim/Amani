import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Calendar } from '../components/Calendar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport, CycleEvent, Intervention, Biomarker } from '../types';
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
  TestTube2
} from 'lucide-react';

export function Dashboard() {
  const { user, userProfile } = useAuth();
  const [reports, setReports] = useState<LabReport[]>([]);
  const [cycleEvents, setCycleEvents] = useState<CycleEvent[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const [reportsResult, eventsResult, interventionsResult] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('*')
          .order('report_date', { ascending: false }),
        supabase
          .from('cycle_events')
          .select('*')
          .eq('user_id', user.id)
          .order('event_date', { ascending: false }),
        supabase
          .from('interventions')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
      ]);

      if (!reportsResult.error && reportsResult.data) {
        const fetchedReports = reportsResult.data as LabReport[];
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
      }

      if (!eventsResult.error && eventsResult.data) {
        setCycleEvents(eventsResult.data as CycleEvent[]);
      }

      if (!interventionsResult.error && interventionsResult.data) {
        setInterventions(interventionsResult.data as Intervention[]);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = async (date: string) => {
    const existingEvent = cycleEvents.find(
      (e) => e.event_date === date && e.event_type === 'period_start'
    );

    if (existingEvent) {
      const confirmDelete = window.confirm('Remove period start marker from this date?');
      if (confirmDelete) {
        await supabase.from('cycle_events').delete().eq('id', existingEvent.id);
        await fetchData();
      }
    } else {
      const confirmAdd = window.confirm('Add period start marker to this date?');
      if (confirmAdd) {
        await supabase.from('cycle_events').insert({
          user_id: user!.id,
          event_date: date,
          event_type: 'period_start',
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
      return daysSinceStart < 30;
    }
    return false;
  };

  const canCreateReport = userProfile?.subscription_status === 'active' || isTrialActive();

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
  const latestCycleEvent = cycleEvents.find(e => e.event_type === 'period_start');
  const daysSinceLastPeriod = latestCycleEvent
    ? Math.floor((new Date().getTime() - new Date(latestCycleEvent.event_date).getTime()) / (1000 * 60 * 60 * 24))
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
    ...cycleEvents
      .filter((e) => e.event_type === 'period_start')
      .map((e) => ({
        date: e.event_date,
        type: 'period' as const,
      })),
  ];

  const getCategoryColor = (category: string): string => {
    const colors: Record<string, string> = {
      supplement: 'bg-amber-100 text-amber-800 border-amber-200',
      diet: 'bg-green-100 text-green-800 border-green-200',
      exercise: 'bg-blue-100 text-blue-800 border-blue-200',
      medication: 'bg-red-100 text-red-800 border-red-200',
      sleep: 'bg-violet-100 text-violet-800 border-violet-200',
      other: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[category] || colors.other;
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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

        {!canCreateReport && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              Your trial has expired. Please activate your subscription to create new reports.
            </p>
            <a href="/app/billing" className="text-yellow-900 underline font-medium">
              Manage subscription
            </a>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Total Lab Reports</p>
                <p className="text-3xl font-bold text-gray-900">{reports.length}</p>
                {daysSinceLastLab !== null && (
                  <p className="text-xs text-gray-600 mt-1">
                    Last lab {daysSinceLastLab} days ago
                  </p>
                )}
              </div>
              <div className="bg-teal-100 p-3 rounded-lg">
                <FileText className="w-6 h-6 text-teal-600" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Cycle Day</p>
                <p className="text-3xl font-bold text-gray-900">
                  {daysSinceLastPeriod !== null ? `Day ${daysSinceLastPeriod + 1}` : 'N/A'}
                </p>
                {latestCycleEvent && (
                  <p className="text-xs text-gray-600 mt-1">
                    Period started {formatDate(latestCycleEvent.event_date)}
                  </p>
                )}
              </div>
              <div className="bg-pink-100 p-3 rounded-lg">
                <Droplet className="w-6 h-6 text-pink-600" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-sky-50 border-blue-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Active Interventions</p>
                <p className="text-3xl font-bold text-gray-900">{activeInterventions.length}</p>
                {activeInterventions.length > 0 && (
                  <p className="text-xs text-gray-600 mt-1">
                    Currently tracking
                  </p>
                )}
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Cycle Events</p>
                <p className="text-3xl font-bold text-gray-900">{cycleEvents.length}</p>
                <p className="text-xs text-gray-600 mt-1">
                  Tracked periods
                </p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <CalendarIcon className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Calendar & Cycle Tracking</h2>
              <a href="/app/tracker" className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1">
                View full tracker <ArrowRight className="w-4 h-4" />
              </a>
            </div>
            <Calendar events={calendarEvents} onDateClick={handleDateClick} />
            <div className="mt-3 p-3 bg-teal-50 rounded-lg border border-teal-200">
              <p className="text-xs text-gray-700">
                Click any date to add or remove period markers. Lab reports are automatically displayed.
              </p>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Active Interventions</h2>
              <a href="/app/tracker" className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                Manage
              </a>
            </div>
            {activeInterventions.length === 0 ? (
              <Card className="border-dashed">
                <div className="text-center py-8 text-gray-600">
                  <Activity className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm">No active interventions</p>
                  <a href="/app/tracker" className="text-sm text-teal-600 hover:text-teal-700 mt-2 inline-block">
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
                  <a href="/app/tracker" className="block text-center text-sm text-teal-600 hover:text-teal-700 py-2">
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
            <a href="/app/tracker" className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1">
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
                  <Card className="hover:shadow-lg transition-all cursor-pointer border-l-4 border-l-teal-500">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="bg-teal-100 p-2 rounded-lg">
                          <FileText className="w-5 h-5 text-teal-600" />
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
              <a href="/app/tracker" className="text-teal-600 hover:text-teal-700 font-medium text-sm">
                View all {reports.length} lab reports
              </a>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
