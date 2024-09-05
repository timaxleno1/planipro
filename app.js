const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument, rgb } = require('pdf-lib');
const { fromPath } = require('pdf2pic');
const http = require('http');
const socketIo = require('socket.io');
const sharp = require('sharp');
const { glob } = require('glob');

// Utilisez la version promise de glob
const globPromise = (pattern, options) => {
    return new Promise((resolve, reject) => {
        glob(pattern, options, (err, files) => {
            if (err) {
                reject(err);
            } else {
                resolve(files);
            }
        });
    });
};

const app = express();
const port = process.env.PORT || 3000;

// Création du serveur HTTP
const server = http.createServer(app);
const io = socketIo(server);

// Map pour stocker les fichiers en attente de traitement
const pendingFiles = new Map();

// Création des dossiers si ils n'existent pas
['uploads', 'highres', 'thumbnails', 'tempPDFs'].forEach(async (dir) => {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        console.error(`Erreur lors de la création du dossier ${dir}:`, err);
    }
});

// Configuration pour multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Middleware pour servir les fichiers statiques
app.use(express.static('public'));
app.use('/highres', express.static(path.join(__dirname, 'highres')));
app.use('/thumbnails', express.static(path.join(__dirname, 'thumbnails')));

// Middleware pour parser le JSON
app.use(express.json());

// Route pour l'upload de fichiers PDF
app.post('/upload', upload.single('pdfFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier n\'a été uploadé.' });
    }

    console.log("Fichier reçu:", req.file.filename);

    // Stocker les informations du fichier dans une variable temporaire
    const fileInfo = {
        path: req.file.path,
        originalName: req.file.originalname,
        socketId: req.body.socketId
    };

    // Associer ces informations à l'ID de socket pour une utilisation ultérieure
    pendingFiles.set(req.body.socketId, fileInfo);

    res.json({ success: true, message: 'Fichier reçu et prêt pour le traitement.' });
});

// Route pour déclencher le traitement du fichier
app.post('/process', (req, res) => {
    const { socketId } = req.body;
    console.log(`Demande de traitement reçue pour le socket ${socketId}`);
    const fileInfo = pendingFiles.get(socketId);

    if (!fileInfo) {
        console.log(`Aucun fichier en attente pour le socket ${socketId}`);
        return res.status(404).json({ success: false, message: 'Aucun fichier en attente pour ce socket.' });
    }

    // Démarrer le traitement du fichier
    console.log(`Début du traitement pour le fichier: ${fileInfo.originalName}`);
    processFile(fileInfo).then(() => {
        pendingFiles.delete(socketId);
        res.json({ success: true, message: 'Traitement du fichier terminé.' });
    }).catch(error => {
        console.error('Erreur lors du traitement du fichier:', error);
        res.status(500).json({ success: false, message: 'Erreur lors du traitement du fichier.' });
    });
});

async function processFile(fileInfo) {
    const pdfPath = fileInfo.path;
    const pdfFileName = path.basename(pdfPath, path.extname(pdfPath));

    try {
        const pdfBytes = await fs.readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const totalPages = pdfDoc.getPageCount();

        console.log(`Nombre de pages: ${totalPages}`);

        // Envoyer l'événement de début de conversion
        io.to(fileInfo.socketId).emit('conversionStarted', { totalPages: totalPages });

        const conversionPromises = [];
        for (let i = 1; i <= totalPages; i++) {
            conversionPromises.push(convertPage(fileInfo.socketId, i, pdfPath, pdfFileName));
        }

        await Promise.all(conversionPromises);

        console.log("Traitement de toutes les pages terminé");
    } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        throw error;
    }
}

async function extractPages(pdfPath, pdfFileName) {
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = [];

    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const newPdfDoc = await PDFDocument.create();
        const [newPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
        newPdfDoc.addPage(newPage);
        const pdfBytes = await newPdfDoc.save();
        const filePath = path.join(__dirname, 'tempPDFs', `${pdfFileName}-page-${i + 1}.pdf`);
        await fs.writeFile(filePath, pdfBytes);
        pages.push({ pageNumber: i + 1, filePath });
    }

    return pages;
}

async function convertPage(socketId, pageNumber, pdfPath, pdfFileName) {
    console.log(`Début de la conversion de la page ${pageNumber} du fichier ${pdfFileName}`);
    const finalImageName = `${pdfFileName}-page-${pageNumber}.png`;
    const finalImagePath = path.join(__dirname, 'highres', finalImageName);
    const thumbnailPath = path.join(__dirname, 'thumbnails', `THUMB_${finalImageName}`);

    try {
        const pdfBytes = await fs.readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const page = pdfDoc.getPages()[pageNumber - 1];

        const { width, height } = page.getSize();
        const scale = 3; // Ajustez cette valeur pour la qualité de l'image haute résolution

        // Créer un nouveau document PDF avec une seule page
        const newPdfDoc = await PDFDocument.create();
        const [newPage] = await newPdfDoc.copyPages(pdfDoc, [pageNumber - 1]);
        newPdfDoc.addPage(newPage);

        // Sauvegarder la page comme un nouveau fichier PDF temporaire
        const tempPdfPath = path.join(__dirname, 'temp', `${pdfFileName}-page-${pageNumber}.pdf`);
        const pdfBytes2 = await newPdfDoc.save();
        await fs.writeFile(tempPdfPath, pdfBytes2);

        // Convertir le PDF en image avec pdf2pic
        const options = {
            density: 300,
            saveFilename: `${pdfFileName}-page-${pageNumber}`,
            savePath: path.join(__dirname, 'temp'),
            format: "png",
            width: Math.round(width * scale),
            height: Math.round(height * scale)
        };
        const convert = fromPath(tempPdfPath, options);
        const pageOutput = await convert(1); // Convertir seulement la première page

        // Utiliser sharp pour redimensionner et sauvegarder l'image haute résolution
        await sharp(pageOutput.path)
            .png()
            .toFile(finalImagePath);

        // Générer et sauvegarder la vignette
        await sharp(finalImagePath)
            .resize({
                width: 200,
                height: 200,
                fit: sharp.fit.inside,
                withoutEnlargement: true
            })
            .toFile(thumbnailPath);

        // Nettoyer les fichiers temporaires
        await fs.unlink(tempPdfPath);
        await fs.unlink(pageOutput.path);

        console.log(`Conversion réussie pour la page ${pageNumber}`);

        io.to(socketId).emit('thumbnailGenerated', {
            page: pageNumber,
            thumbnail: `/thumbnails/THUMB_${finalImageName}`,
            highRes: `/highres/${finalImageName}`,
            pdfFileName: pdfFileName,
            width: width,
            height: height
        });

        return finalImagePath;
    } catch (error) {
        console.error(`Erreur lors de la conversion de la page ${pageNumber}:`, error);
        io.to(socketId).emit('error', { message: `Erreur lors de la conversion de la page ${pageNumber}` });
        throw error;
    }
}

async function generateThumbnail(imagePath, pageNumber, socketId, pdfFileName) {
    const thumbnailName = `THUMB_${pdfFileName}-page-${pageNumber}.png`;
    const thumbnailPath = path.join(__dirname, 'thumbnails', thumbnailName);
    try {
        await sharp(imagePath)
            .resize({ width: 200 })
            .toFile(thumbnailPath);

        io.to(socketId).emit('thumbnailGenerated', {
            page: pageNumber,
            thumbnail: `/thumbnails/${thumbnailName}`,
            highRes: `/highres/${path.basename(imagePath)}`,
            pdfFileName: pdfFileName
        });
        console.log(`Vignette générée pour la page ${pageNumber}`);
    } catch (err) {
        console.error(`Erreur lors de la génération de la vignette pour la page ${pageNumber}`, err);
        throw err;
    }
}

// Route pour obtenir les vignettes existantes
app.get('/thumbnails', async (req, res) => {
    try {
        const files = await fs.readdir('thumbnails');
        const thumbnails = files
            .filter(file => file.startsWith('THUMB_'))
            .map(file => {
                const match = file.match(/THUMB_(.+)-page-(\d+)\.png/);
                if (match) {
                    const [, pdfFileName, pageNumber] = match;
                    return {
                        page: parseInt(pageNumber, 10),
                        thumbnail: `/thumbnails/${file}`,
                        highRes: `/highres/${pdfFileName}-page-${pageNumber}.png`,
                        pdfFileName: pdfFileName
                    };
                }
            })
            .filter(Boolean);

        console.log(`Nombre de vignettes trouvées: ${thumbnails.length}`);
        console.log("Exemple de vignette:", thumbnails[0]);
        res.json({ thumbnails });
    } catch (err) {
        console.error('Erreur lors de la lecture du répertoire thumbnails', err);
        res.status(500).json({ error: 'Erreur lors de la lecture du répertoire thumbnails' });
    }
});

app.post('/delete-thumbnail', async (req, res) => {
    const { page, pdfFileName } = req.body;
    console.log(`Tentative de suppression de la page ${page} du fichier ${pdfFileName}`);

    try {
        const thumbnailPath = path.join(__dirname, 'thumbnails', `THUMB_${pdfFileName}-page-${page}.png`);
        console.log(`Chemin de la vignette : ${thumbnailPath}`);

        if (await fs.access(thumbnailPath).then(() => true).catch(() => false)) {
            await fs.unlink(thumbnailPath);
            console.log(`Vignette supprimée : ${thumbnailPath}`);
        } else {
            console.log(`La vignette n'existe pas : ${thumbnailPath}`);
        }

        const highResPath = path.join(__dirname, 'highres', `${pdfFileName}-page-${page}.png`);
        console.log(`Chemin de l'image haute résolution : ${highResPath}`);

        if (await fs.access(highResPath).then(() => true).catch(() => false)) {
            await fs.unlink(highResPath);
            console.log(`Image haute résolution supprimée : ${highResPath}`);
        } else {
            console.log(`L'image haute résolution n'existe pas : ${highResPath}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error(`Erreur lors de la suppression des fichiers pour la page ${page} du fichier ${pdfFileName}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Démarrer le serveur
server.listen(port, '0.0.0.0', () => {
    console.log(`Serveur démarré sur http://0.0.0.0:${port}`);
});

io.on('connection', (socket) => {
    console.log('Un utilisateur est connecté: ', socket.id);

    socket.on('disconnect', () => {
        console.log('Un utilisateur est déconnecté');
    });
});