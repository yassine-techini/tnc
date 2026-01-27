import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Image } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import InlineMessage from '../../components/InlineMessage';
import ConfirmDialog from '../../components/ConfirmDialog';

type CaptureStep = 'front' | 'back' | 'selfie';

interface CapturedImages {
  front?: string;
  back?: string;
  selfie?: string;
}

const STEP_CONFIG: Record<CaptureStep, { title: string; instruction: string; icon: string }> = {
  front: {
    title: 'Recto du document',
    instruction: 'Placez le recto de votre document dans le cadre',
    icon: '🪪',
  },
  back: {
    title: 'Verso du document',
    instruction: 'Placez le verso de votre document dans le cadre',
    icon: '🔄',
  },
  selfie: {
    title: 'Selfie de verification',
    instruction: 'Tenez votre document a cote de votre visage',
    icon: '🤳',
  },
};

export default function CameraScreen() {
  const params = useLocalSearchParams<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    documentType: string;
    documentNumber: string;
    requiresBack: string;
    step: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  const [currentStep, setCurrentStep] = useState<CaptureStep>((params.step as CaptureStep) || 'front');
  const [capturedImages, setCapturedImages] = useState<CapturedImages>({});
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const requiresBack = params.requiresBack === 'true';

  useEffect(() => {
    if (currentStep === 'selfie') {
      setCameraFacing('front');
    } else {
      setCameraFacing('back');
    }
  }, [currentStep]);

  const getNextStep = (): CaptureStep | null => {
    if (currentStep === 'front') {
      return requiresBack ? 'back' : 'selfie';
    }
    if (currentStep === 'back') {
      return 'selfie';
    }
    return null;
  };

  const takePicture = async () => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });
      if (photo?.uri) {
        setPreviewUri(photo.uri);
      }
    } catch (error) {
      setErrorMsg('Impossible de prendre la photo. Veuillez reessayer.');
    } finally {
      setIsCapturing(false);
    }
  };

  const retakePhoto = () => {
    setPreviewUri(null);
  };

  const confirmPhoto = () => {
    if (!previewUri) return;

    const newImages = { ...capturedImages, [currentStep]: previewUri };
    setCapturedImages(newImages);

    const nextStep = getNextStep();
    if (nextStep) {
      setCurrentStep(nextStep);
      setPreviewUri(null);
    } else {
      // All photos captured, go to review
      router.push({
        pathname: '/(kyc)/review',
        params: {
          firstName: params.firstName,
          lastName: params.lastName,
          dateOfBirth: params.dateOfBirth,
          documentType: params.documentType,
          documentNumber: params.documentNumber,
          frontImage: newImages.front,
          backImage: newImages.back || '',
          selfieImage: newImages.selfie || previewUri,
        },
      });
    }
  };

  const handleCancel = () => {
    setShowCancelConfirm(true);
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.permissionText}>Chargement...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Acces a la camera requis</Text>
          <Text style={styles.permissionText}>
            Pour verifier votre identite, nous avons besoin d'acceder a votre camera pour photographier vos documents.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Autoriser la camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const stepConfig = STEP_CONFIG[currentStep];
  const progress = currentStep === 'front' ? 1 : currentStep === 'back' ? 2 : requiresBack ? 3 : 2;
  const totalSteps = requiresBack ? 3 : 2;

  if (previewUri) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>Verifiez la photo</Text>
          <Text style={styles.previewSubtitle}>{stepConfig.title}</Text>
        </View>

        <View style={styles.previewContainer}>
          <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
        </View>

        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retakeButton} onPress={retakePhoto}>
            <Text style={styles.retakeButtonText}>Reprendre</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={confirmPhoto}>
            <Text style={styles.confirmButtonText}>Confirmer</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewTips}>
          <Text style={styles.tipTitle}>Assurez-vous que:</Text>
          <Text style={styles.tipText}>✓ Le document est bien visible</Text>
          <Text style={styles.tipText}>✓ Les informations sont lisibles</Text>
          <Text style={styles.tipText}>✓ Pas de reflets ou de flou</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={handleCancel}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerIcon}>{stepConfig.icon}</Text>
          <Text style={styles.headerTitle}>{stepConfig.title}</Text>
        </View>
        <Text style={styles.stepIndicator}>{progress}/{totalSteps}</Text>
      </View>

      {/* Camera */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={cameraFacing}
        >
          {/* Guide overlay */}
          <View style={styles.overlay}>
            {currentStep === 'selfie' ? (
              <View style={styles.selfieGuide}>
                <View style={styles.faceOutline} />
                <View style={styles.documentGuide}>
                  <Text style={styles.documentGuideText}>Document ici</Text>
                </View>
              </View>
            ) : (
              <View style={styles.documentFrame}>
                <View style={styles.cornerTL} />
                <View style={styles.cornerTR} />
                <View style={styles.cornerBL} />
                <View style={styles.cornerBR} />
              </View>
            )}
          </View>
        </CameraView>
      </View>

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionText}>{stepConfig.instruction}</Text>
      </View>

      {errorMsg ? (
        <View style={{ paddingHorizontal: 16 }}>
          <InlineMessage type="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />
        </View>
      ) : null}

      {/* Capture button */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
          onPress={takePicture}
          disabled={isCapturing}
        >
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>
      </View>

      {/* Tips */}
      <View style={styles.tips}>
        <Text style={styles.tipItem}>💡 Bonne luminosite</Text>
        <Text style={styles.tipItem}>📐 Document bien cadre</Text>
        <Text style={styles.tipItem}>🚫 Evitez les reflets</Text>
      </View>

      {showCancelConfirm && (
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: 'rgba(0,0,0,0.9)' }}>
          <ConfirmDialog
            title="Annuler la verification"
            message="Etes-vous sur de vouloir annuler ? Toutes les photos seront perdues."
            confirmText="Annuler"
            cancelText="Continuer"
            onConfirm={() => router.back()}
            onCancel={() => setShowCancelConfirm(false)}
            destructive
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Permission screen
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0F0F1A',
  },
  permissionIcon: { fontSize: 64, marginBottom: 24 },
  permissionTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  permissionText: { color: '#9CA3AF', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  permissionButton: { backgroundColor: '#D4AF37', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12 },
  permissionButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },
  cancelButton: { marginTop: 16, padding: 12 },
  cancelButtonText: { color: '#9CA3AF', fontSize: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0F0F1A',
  },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: '#fff', fontSize: 24 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon: { fontSize: 24 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stepIndicator: { color: '#D4AF37', fontSize: 14, fontWeight: '600' },

  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  // Overlay
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  documentFrame: {
    width: '85%',
    aspectRatio: 1.6,
    borderWidth: 2,
    borderColor: 'rgba(212, 175, 55, 0.5)',
    borderRadius: 12,
    position: 'relative',
  },
  cornerTL: { position: 'absolute', top: -2, left: -2, width: 30, height: 30, borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#D4AF37', borderTopLeftRadius: 12 },
  cornerTR: { position: 'absolute', top: -2, right: -2, width: 30, height: 30, borderTopWidth: 4, borderRightWidth: 4, borderColor: '#D4AF37', borderTopRightRadius: 12 },
  cornerBL: { position: 'absolute', bottom: -2, left: -2, width: 30, height: 30, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#D4AF37', borderBottomLeftRadius: 12 },
  cornerBR: { position: 'absolute', bottom: -2, right: -2, width: 30, height: 30, borderBottomWidth: 4, borderRightWidth: 4, borderColor: '#D4AF37', borderBottomRightRadius: 12 },

  selfieGuide: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  faceOutline: {
    width: 200,
    height: 260,
    borderWidth: 3,
    borderColor: '#D4AF37',
    borderRadius: 100,
    marginBottom: 20,
  },
  documentGuide: {
    width: 120,
    height: 80,
    borderWidth: 2,
    borderColor: 'rgba(212, 175, 55, 0.5)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    bottom: '20%',
    left: '10%',
  },
  documentGuideText: { color: '#D4AF37', fontSize: 12 },

  // Instructions
  instructions: {
    backgroundColor: '#0F0F1A',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  instructionText: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '500' },

  // Controls
  controls: {
    backgroundColor: '#0F0F1A',
    paddingVertical: 24,
    alignItems: 'center',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonDisabled: { opacity: 0.5 },
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#D4AF37' },

  // Tips
  tips: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingBottom: 16,
    backgroundColor: '#0F0F1A',
  },
  tipItem: { color: '#9CA3AF', fontSize: 12 },

  // Preview screen
  previewHeader: {
    backgroundColor: '#0F0F1A',
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  previewTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  previewSubtitle: { color: '#D4AF37', fontSize: 14 },

  previewContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', padding: 16 },
  previewImage: { flex: 1, borderRadius: 12 },

  previewActions: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#0F0F1A',
  },
  retakeButton: {
    flex: 1,
    backgroundColor: '#374151',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  retakeButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  confirmButton: {
    flex: 1,
    backgroundColor: '#D4AF37',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  previewTips: {
    backgroundColor: '#0F0F1A',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  tipTitle: { color: '#9CA3AF', fontSize: 14, marginBottom: 8 },
  tipText: { color: '#6B7280', fontSize: 13, marginBottom: 4 },
});
