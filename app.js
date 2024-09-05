const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const pdf = require('pdf-poppler');
const http = require('http');
const socketIo = require('socket.io');
const sharp = require('sharp');
const { glob } = require('glob');
const util = require('util');

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

// Cr�ation du serveur HTTP
const server = http.createServer(app);
const io = socketIo(server);

// Map pour stocker les fichiers en attente de traitement
const pendingFiles = new Map();

// Cr�ation des dossiers si ils n'existent pas
['uploads', 'highres', 'thumbnails', 'tempPDFs'].forEach(async (dir) => {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        console.error(`Erreur lors de la cr�ation du dossier ${dir}:`, err);
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
        return res.status(400).json({ success: false, message: 'Aucun fichier n\'a �t� upload�.' });
    }

    console.log("Fichier re�u:", req.file.filename);

    // Stocker les informations du fichier dans une variable temporaire
    const fileInfo = {
        path: req.file.path,
        originalName: req.file.originalname,
        socketId: req.body.socketId
    };

    // Associer ces informations � l'ID de socket pour une utilisation ult�rieure
    pendingFiles.set(req.body.socketId, fileInfo);

    res.json({ success: true, message: 'Fichier re�u et pr�t pour le traitement.' });
});

// Route pour d�clencher le traitement du fichier
app.post('/process', (req, res) => {
    const { socketId } = req.body;
    console.log(`Demande de traitement re�ue pour le socket ${socketId}`);
    const fileInfo = pendingFiles.get(socketId);

    if (!fileInfo) {
        console.log(`Aucun fichier en attente pour le socket ${socketId}`);
        return res.status(404).json({ success: false, message: 'Aucun fichier en attente pour ce socket.' });
    }

    // D�marrer le traitement du fichier
    console.log(`D�but du traitement pour le fichier: ${fileInfo.originalName}`);
    processFile(fileInfo).then(() => {
        pendingFiles.delete(socketId);
        res.json({ success: true, message: 'Traitement du fichier termin�.' });
    }).catch(error => {
        console.error('Erreur lors du traitement du fichier:', error);
        res.status(500).json({ success: false, message: 'Erreur lors du traitement du fichier.' });
    });
});

async function processFile(fileInfo) {
    const pdfPath = fileInfo.path;
    const pdfFileName = path.basename(pdfPath, path.extname(pdfPath));

    // Extraire chaque page en tant que PDF individuel
    const pages = await extractPages(pdfPath, pdfFileName);
    console.log(`Nombre de pages extraites: ${pages.length}`);

    // Convertir chaque page individuellement et envoyer des mises � jour de progression
    const totalPages = pages.length;
    let completedPages = 0;

    const conversionPromises = pages.map(async (page) => {
        try {
            await convertPage(fileInfo.socketId, page.pageNumber, pdfPath, pdfFileName);
            completedPages++;
            const overallProgress = (completedPages / totalPages) * 100;
            io.to(fileInfo.socketId).emit('overallProgress', { percentComplete: overallProgress });
        } catch (error) {
            console.error(`Erreur d�taill�e lors de la conversion de la page ${page.pageNumber}:`, error);
            io.to(fileInfo.socketId).emit('pageConversionError', {
                page: page.pageNumber,
                error: error.message,
                stack: error.stack
            });
        }
    });

    await Promise.all(conversionPromises);
    console.log("Traitement de toutes les pages termin�");
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
    console.log(`D�but de la conversion de la page ${pageNumber} du fichier ${pdfFileName}`);
    const expectedImageName = `${pdfFileName}-page-${pageNumber}.png`;
    const expectedImagePath = path.join(__dirname, 'highres', expectedImageName);
    const actualImageName = `${pdfFileName}-${pageNumber}.png`;
    const actualImagePath = path.join(__dirname, actualImageName);

    console.log(`Chemin de l'image attendu : ${expectedImagePath}`);
    console.log(`Chemin de l'image g�n�r� : ${actualImagePath}`);

    const opts = {
        format: 'png',
        out_dir: __dirname,  // Utilisez le r�pertoire racine du projet
        out_prefix: pdfFileName,
        page: pageNumber,
        scale: 2.0,
    };

    try {
        await pdf.convert(pdfPath, opts);
        console.log(`Conversion r�ussie pour la page ${pageNumber}`);

        if (await fs.access(actualImagePath).then(() => true).catch(() => false)) {
            console.log(`Fichier g�n�r� trouv� : ${actualImagePath}`);

            // D�placer et renommer le fichier
            await fs.rename(actualImagePath, expectedImagePath);
            console.log(`Image d�plac�e et renomm�e de ${actualImageName} � ${expectedImageName}`);

            await generateThumbnail(expectedImagePath, pageNumber, socketId, pdfFileName);
            console.log(`Vignette g�n�r�e pour la page ${pageNumber}`);

            io.to(socketId).emit('conversionProgress', {
                page: pageNumber,
                percentComplete: 100,
                highRes: `/highres/${expectedImageName}`
            });

            return expectedImagePath;
        } else {
            throw new Error(`Le fichier g�n�r� n'a pas �t� trouv� : ${actualImagePath}`);
        }
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
        console.log(`Vignette g�n�r�e pour la page ${pageNumber}`);
    } catch (err) {
        console.error(`Erreur lors de la g�n�ration de la vignette pour la page ${pageNumber}`, err);
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

        console.log(`Nombre de vignettes trouv�es: ${thumbnails.length}`);
        console.log("Exemple de vignette:", thumbnails[0]);
        res.json({ thumbnails });
    } catch (err) {
        console.error('Erreur lors de la lecture du r�pertoire thumbnails', err);
        res.status(500).json({ error: 'Erreur lors de la lecture du r�pertoire thumbnails' });
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
            console.log(`Vignette supprim�e : ${thumbnailPath}`);
        } else {
            console.log(`La vignette n'existe pas : ${thumbnailPath}`);
        }

        const highResPath = path.join(__dirname, 'highres', `${pdfFileName}-page-${page}.png`);
        console.log(`Chemin de l'image haute r�solution : ${highResPath}`);

        if (await fs.access(highResPath).then(() => true).catch(() => false)) {
            await fs.unlink(highResPath);
            console.log(`Image haute r�solution supprim�e : ${highResPath}`);
        } else {
            console.log(`L'image haute r�solution n'existe pas : ${highResPath}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error(`Erreur lors de la suppression des fichiers pour la page ${page} du fichier ${pdfFileName}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// D�marrer le serveur
server.listen(port, '0.0.0.0', () => {
    console.log(`Serveur d�marr� sur http://0.0.0.0:${port}`);
});

io.on('connection', (socket) => {
    console.log('Un utilisateur est connect�: ', socket.id);

    socket.on('disconnect', () => {
        console.log('Un utilisateur est d�connect�');
    });
});