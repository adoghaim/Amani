import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport } from '../types';
import { FileText, Plus, Clock, CheckCircle, XCircle } from 'lucide-react';

export function Dashboard() {
  const { user, userProfile } = useAuth();
  const [reports, setReports] = useState<LabReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchReports();
    }
  }, [user]);

  const fetchReports = async () => {
    const { data, error } = await supabase
      .from('lab_reports')
      .select('*')
      .order('report_date', { ascending: false });

    if (!error && data) {
      setReports(data as LabReport[]);
    }
    setLoading(false);
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
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to Amani
            </h1>
            <p className="text-gray-600">
              View your lab reports and create new ones.
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

        {reports.length === 0 ? (
          <Card>
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
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
          <div className="space-y-4">
            {reports.map((report) => (
              <a
                key={report.id}
                href={`/app/reports/${report.id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <FileText className="w-8 h-8 text-teal-600" />
                      <div>
                        <div className="font-semibold text-gray-900">
                          Lab Report - {formatDate(report.report_date)}
                        </div>
                        <div className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                          {getStatusIcon(report.status)}
                          <span>{getStatusText(report.status)}</span>
                          {report.estimated_cycle_phase !== 'unknown' && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{report.estimated_cycle_phase} phase</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      Uploaded {formatDate(report.upload_date)}
                    </div>
                  </div>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
