import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api } from '../../lib/api';
import { captureOrigin, formatPosition, type DevicePosition } from '../../lib/geolocation';

const GOLD_TYPES = [
  { value: 'nuggets' as const, label: 'Pépites' },
  { value: 'powder' as const, label: 'Poudre' },
  { value: 'bar' as const, label: 'Barre' },
];

const MAX_PHOTOS = 6;

interface LocalPhoto {
  uri: string;
  name: string;
  type: string;
}

export default function NewConsignmentScreen() {
  const c = useThemeColors();
  const [weight, setWeight] = useState('');
  const [karat, setKarat] = useState('22');
  const [goldType, setGoldType] = useState<'nuggets' | 'powder' | 'bar'>('nuggets');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [originZone, setOriginZone] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightValue = Number(weight.replace(',', '.'));
  const karatValue = Number(karat);
  const canSubmit =
    Number.isFinite(weightValue) && weightValue > 0 && karatValue > 0 && karatValue <= 24 && !submitting;

  function toLocalPhoto(asset: ImagePicker.ImagePickerAsset, index: number): LocalPhoto {
    // The API decides the real type from the bytes; this is only the multipart
    // part header, and a sane extension keeps the picker's output honest.
    const type = asset.mimeType || 'image/jpeg';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { uri: asset.uri, name: `lot_${Date.now()}_${index}.${ext}`, type };
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Appareil photo', "L'accès à l'appareil photo est nécessaire pour photographier le lot.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, toLocalPhoto(result.assets[0], prev.length)].slice(0, MAX_PHOTOS));
    }
  }

  async function pickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    if (!result.canceled) {
      setPhotos((prev) =>
        [...prev, ...result.assets.map((a, i) => toLocalPhoto(a, prev.length + i))].slice(0, MAX_PHOTOS)
      );
    }
  }

  async function locate() {
    setLocating(true);
    setLocationNote(null);
    const outcome = await captureOrigin();
    setLocating(false);

    if (outcome.status === 'ok') {
      setPosition(outcome.position);
      return;
    }
    // Refusal and unavailability lead to the same place: declare the zone by
    // hand. It is recorded as declared, never as a measured position.
    setPosition(null);
    setLocationNote(
      outcome.status === 'denied'
        ? "Position refusée. Indiquez la zone d'extraction ci-dessous — elle sera enregistrée comme déclarée."
        : `${outcome.reason}. Indiquez la zone d'extraction ci-dessous.`
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // Photos are uploaded first; the API returns a key for each and only
      // accepts keys under this producer's own prefix.
      const keys: string[] = [];
      for (const photo of photos) {
        const { key } = await api.uploadConsignmentPhoto(photo);
        keys.push(key);
      }

      await api.submitConsignment({
        weightGrams: weightValue,
        purity: karatValue / 24,
        goldType,
        photos: keys.length ? keys : undefined,
        // gpsVerified is true ONLY for a device fix. The typed zone travels
        // separately and is stored as a declaration.
        gps: position ? { lat: position.lat, lng: position.lng } : undefined,
        gpsVerified: position ? true : undefined,
        originZone: originZone.trim() || undefined,
      });

      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, { color: c.textSecondary }]}>Poids déclaré (grammes)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
        placeholder="1000"
        placeholderTextColor={c.textTertiary}
      />

      <Text style={[styles.label, { color: c.textSecondary }]}>Pureté (carats)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
        value={karat}
        onChangeText={setKarat}
        keyboardType="number-pad"
        placeholder="22"
        placeholderTextColor={c.textTertiary}
      />

      <Text style={[styles.label, { color: c.textSecondary }]}>Type</Text>
      <View style={styles.row}>
        {GOLD_TYPES.map((t) => (
          <TouchableOpacity
            key={t.value}
            onPress={() => setGoldType(t.value)}
            style={[
              styles.chip,
              { borderColor: c.border, backgroundColor: goldType === t.value ? c.gold : c.surface },
            ]}
          >
            <Text style={{ color: goldType === t.value ? '#000' : c.textSecondary, fontWeight: '600' }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>Origine du lot</Text>
      <TouchableOpacity
        style={[styles.photoButton, { backgroundColor: c.surface, borderColor: c.border }]}
        onPress={locate}
        disabled={locating}
      >
        <Ionicons name="location-outline" size={20} color={c.gold} />
        <Text style={{ color: c.text, marginLeft: 8 }}>
          {locating ? 'Localisation…' : position ? 'Actualiser la position' : 'Relever la position'}
        </Text>
      </TouchableOpacity>

      {position && (
        <Text style={{ color: c.success, fontSize: 12, marginTop: 8 }}>
          Position relevée : {formatPosition(position)}
        </Text>
      )}
      {locationNote && (
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
          {locationNote}
        </Text>
      )}

      <TextInput
        style={[
          styles.input,
          { backgroundColor: c.surface, borderColor: c.border, color: c.text, marginTop: 10 },
        ]}
        value={originZone}
        onChangeText={setOriginZone}
        placeholder="Zone d'extraction (site, commune)"
        placeholderTextColor={c.textTertiary}
      />

      <Text style={[styles.label, { color: c.textSecondary }]}>
        Photos du lot ({photos.length}/{MAX_PHOTOS})
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.photoButton, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={takePhoto}
          disabled={photos.length >= MAX_PHOTOS}
        >
          <Ionicons name="camera-outline" size={20} color={c.gold} />
          <Text style={{ color: c.text, marginLeft: 8 }}>Photographier</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.photoButton, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={pickPhotos}
          disabled={photos.length >= MAX_PHOTOS}
        >
          <Ionicons name="images-outline" size={20} color={c.gold} />
          <Text style={{ color: c.text, marginLeft: 8 }}>Galerie</Text>
        </TouchableOpacity>
      </View>

      {photos.length > 0 && (
        <View style={styles.thumbs}>
          {photos.map((p, i) => (
            <TouchableOpacity
              key={p.uri}
              onPress={() => setPhotos((prev) => prev.filter((_, index) => index !== i))}
            >
              <Image source={{ uri: p.uri }} style={[styles.thumb, { borderColor: c.border }]} />
              <View style={[styles.removeBadge, { backgroundColor: c.error }]}>
                <Ionicons name="close" size={12} color="#fff" />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error && <Text style={[styles.error, { color: c.error }]}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submit, { backgroundColor: canSubmit ? c.gold : c.border }]}
        onPress={submit}
        disabled={!canSubmit}
      >
        {submitting ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.submitText}>Déclarer le lot</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.note, { color: c.textTertiary }]}>
        Le poids définitif est celui mesuré après raffinage à Dubaï. Vous serez crédité en tokens
        (1 token = 1 gramme) à la validation de l'audit.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  thumb: { width: 72, height: 72, borderRadius: 10, borderWidth: 1 },
  removeBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { marginTop: 16, fontSize: 13 },
  submit: { marginTop: 24, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText: { color: '#000', fontWeight: '700', fontSize: 15 },
  note: { fontSize: 12, marginTop: 16, lineHeight: 18 },
});
